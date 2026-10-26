// Bid in a round, like a checkout: the round on the left, one card on the right that walks through the three steps
// (seal your price, pay the deposit, wait for it to count). The price and the refund address never leave this page:
// it seals the price to drand round R with the shipped sealer, seals the address to the three signers, and sends the
// operator only the sealed record of a deposit you paid from your own wallet. The bid key is yours to keep.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, MODE_NAME, short, zec } from "../../lib/api";
import { glyphFor } from "../../lib/glyphs";
import { partyFor, type PartyKey } from "../../lib/mine";
import { Btn, Copyable, ErrorLine, Field, Panel, Pill, cx, fieldCls, rel, zats, when } from "../app/ui";
import { clock, useCountdown } from "./useCountdown";
import type { AuctionDetail } from "../../lib/types";

type Saved = { step: "pay" | "track"; bid: any; txid?: string; savedKey?: boolean };
const store = (id: string) => `benzo:bid:${id}`;

// What the price means in each market, and its limits from the signed manifest.
function priceRule(d: AuctionDetail, side: string | null) {
  const m: any = d.manifest, lo = Number(m.reserve_zats ?? 0) || 10, hi = Number(m.buyback?.max_price_zats ?? m.rfq?.max_price_zats ?? m.B_max_zats);
  const label = d.mode === "buyback" ? "Your ask" : d.mode === "rfq" ? "Your quote" : d.mode === "otc" ? (side === "seller" ? "Lowest price you'll accept" : "Highest price you'll pay") : "Your price";
  const paid = d.mode === "buyback" || d.mode === "rfq" || side === "seller";
  return { label, lo: d.mode === "otc" ? 10 : lo, hi, tick: Number(m.tick_zats ?? 10), paid };
}

export default function BidView() {
  const q = new URLSearchParams(location.search);
  const [round, setRound] = useState<AuctionDetail | null | undefined>(undefined);
  const [saved, setSaved] = useState<Saved | null>(null);
  useEffect(() => {
    (async () => {
      const list = await api.auctions();
      const pick = list.find((a) => a.id === q.get("id") && a.live) ?? (q.get("id") ? null : list.find((a) => a.live && a.state === "OPEN")) ?? null;
      const d = pick ? await api.auction(pick.id) : null;
      setRound(d);
      if (d) { const s = localStorage.getItem(store(d.id)); if (s) setSaved(JSON.parse(s)); }
    })().catch(() => setRound(null));
  }, []);
  const keep = (s: Saved | null) => { setSaved(s); if (round) s ? localStorage.setItem(store(round.id), JSON.stringify(s)) : localStorage.removeItem(store(round.id)); };
  const left = useCountdown(round?.T_submit);

  if (round === undefined) return <h1 className="py-16 text-[26px] text-app-muted" data-testid="ticket-title">Finding the round…</h1>;
  if (!round) return (
    <div className="mx-auto max-w-[520px] py-16 text-center">
      <img src="/doodles/hourglass.svg?v=2" alt="" className="mx-auto size-14 opacity-80" />
      <h1 className="mt-6 text-[26px]" data-testid="ticket-title">No round is taking bids here</h1>
      <p className="mt-2 text-app-muted">This round has closed, or the link is old. Start your own, or pick a market.</p>
      <div className="mt-7 flex justify-center gap-3"><Btn href="/start/" testid="bid-start">Start a round</Btn><Btn href="/" kind="secondary">All markets</Btn></div>
    </div>
  );
  const party = round.mode === "otc" || round.mode === "rfq" ? partyFor(round.request) : null;
  const step = !saved ? 0 : saved.step === "pay" ? 1 : 2;
  return (
    // Phone: the round, then the card, then the notes. Desktop: the round and its notes left, the card right.
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_1fr] lg:gap-x-10">
      <RoundSummary round={round} left={left} />
      <Panel className="self-start lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <Steps step={step} />
        <div className="mt-6">
          {(round.mode === "otc" || round.mode === "rfq") && !party && !saved
            ? <div data-testid="bid-parties-only"><div className="text-[16px] font-medium">Invited parties only</div><p className="mt-1 text-[14px] text-app-muted">This round takes bids from the people its creator invited. Open your invite link on this device to bid.</p></div>
            : <>
              {!saved && <Form round={round} party={party} onSealed={(bid) => keep({ step: "pay", bid })} />}
              {saved?.step === "pay" && <Pay round={round} s={saved} onKey={() => keep({ ...saved, savedKey: true })} onPaid={(txid) => keep({ ...saved, step: "track", txid })} onRestart={() => keep(null)} />}
              {saved?.step === "track" && <Track round={round} s={saved} onRestart={() => keep(null)} />}
            </>}
        </div>
      </Panel>
      <Notes round={round} />
    </div>
  );
}

function RoundSummary({ round, left }: { round: AuctionDetail; left: number | null }) {
  const m: any = round.manifest;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-4">
        <img src={`/doodles/${glyphFor(round.mode, round.id)}.svg?v=2`} alt="" className="size-14 shrink-0 rounded-2xl bg-app-1 p-2.5" />
        <div className="min-w-0">
          <div className="text-[13px] text-app-faint">{MODE_NAME[round.mode]}</div>
          <h1 className="truncate text-[26px]" data-testid="ticket-title">{round.lot ?? "Live round"}</h1>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
        <div><div className="text-[13px] text-app-faint">Bids close</div><div className={cx("mt-1 text-[22px] font-semibold tabular-nums", left ? "text-gold" : "text-app-muted")} data-testid="ticket-light">{left ? clock(left) : "Closed"}</div><div className="text-[13px] text-app-muted">{when(round.T_submit)}</div></div>
        <div><div className="text-[13px] text-app-faint">Deposit</div><div className="mt-1 text-[22px] font-semibold tabular-nums">{zec(round.C_zats)} TAZ</div><div className="text-[13px] text-app-muted">returned unless you win</div></div>
        <div><div className="text-[13px] text-app-faint">{m.lots ? "Lots" : "Units for sale"}</div><div className="mt-1 text-[17px] font-medium">{m.lots ? m.lots.join(", ") : round.supply}</div></div>
        <div><div className="text-[13px] text-app-faint">Bids open</div><div className="mt-1 text-[17px] font-medium">{rel(round.release)}</div><div className="text-[13px] text-app-muted">{when(round.release)}</div></div>
      </div>
    </div>
  );
}

function Notes({ round }: { round: AuctionDetail }) {
  const m: any = round.manifest;
  return (
    <div className="lg:col-start-1 lg:row-start-2">
      <ul className="grid gap-3 text-[14px] text-app-muted">
        <li className="flex gap-3"><span className="text-gold" aria-hidden>●</span>Your price is sealed in this browser. Nobody, the operator included, can read it before the bids open.</li>
        <li className="flex gap-3"><span className="text-gold" aria-hidden>●</span>Every bidder pays the same deposit, so the deposit gives nothing away.</li>
        <li className="flex gap-3"><span className="text-gold" aria-hidden>●</span>{m.lots || round.mode === "uniform" || round.mode === "launch" ? "Winners all pay the same clearing price; the rest of the deposit comes back." : round.mode === "buyback" || round.mode === "rfq" ? "Accepted offers are paid on top of the returned deposit." : "If the two limits cross, you trade at the midpoint."}</li>
      </ul>
      <a href={`/auction/?id=${round.id}`} className="mt-6 inline-block text-[14px] text-app-muted underline-offset-4 hover:text-app-text hover:underline">See the round</a>
    </div>
  );
}

function Steps({ step }: { step: number }) {
  const names = ["Seal", "Pay", "Track"];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Steps">
      {names.map((n, i) => (
        <li key={n} aria-current={i === step ? "step" : undefined}>
          <span aria-hidden className={cx("block h-[3px] rounded-full", i < step ? "bg-app-muted" : i === step ? "bg-gold" : "bg-app-2")} />
          <span className={cx("mt-2 block text-[13px]", i === step ? "font-medium text-app-text" : "text-app-faint")}>{n}</span>
        </li>
      ))}
    </ol>
  );
}

function Form({ round, party, onSealed }: { round: AuctionDetail; party: PartyKey | null; onSealed: (bid: any) => void }) {
  const q = new URLSearchParams(location.search);
  const lots: string[] | undefined = (round.manifest as any).lots;
  const rule = priceRule(round, party?.label === "Seller" ? "seller" : party?.label === "Buyer" ? "buyer" : null);
  const [price, setPrice] = useState(q.get("price") ?? "");
  const [lot, setLot] = useState(lots?.[0] ?? "");
  const [refund, setRefund] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try {
      setBusy("Reserving your deposit address…");
      const slot = await api.slot(round.id, party?.public_hex);
      setBusy("Checking the round's signature…");
      const packet = await api.packet(round.id);
      setBusy("Sealing your price…");
      const { prepareSealedBid } = await import("../../lib/bidder");
      const bid = await prepareSealedBid({ packet: packet.manifest, signer: packet.signer, address: slot.address, price_zats: price.trim(), refund_ua: refund.trim(), lot: lots ? lot : undefined, owner_private_hex: party?.private_hex });
      onSealed({ ...bid, lot: lots ? lot : undefined });
    } catch (x) {
      const msg = String((x as Error).message);
      setErr(/unified address|destination|refund/i.test(msg) ? "That isn't a shielded testnet address. It should start with utest1." : msg.replace(/^[^:]*: \d+ /, ""));
    } finally { setBusy(""); }
  };
  return (
    <form onSubmit={go} className="grid gap-5" data-testid="bid-form">
      {party && <div className="flex items-center justify-between text-[14px]" data-testid="bid-party"><span className="text-app-faint">Bidding as</span><Pill kind="wait">{party.label}</Pill></div>}
      {lots && (
        <Field label="Lot">
          <select value={lot} onChange={(e) => setLot(e.target.value)} className={fieldCls} data-testid="bid-lot">{lots.map((l) => <option key={l}>{l}</option>)}</select>
        </Field>
      )}
      <Field label={rule.label} help={`Between ${zats(rule.lo)} and ${zats(rule.hi)} zats, in steps of ${rule.tick}.`}>
        <div className="relative">
          <input name="price" inputMode="numeric" required value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} className={cx(fieldCls, "pr-14 text-[17px] tabular-nums")} data-testid="bid-price" autoComplete="off" />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-app-faint">zats</span>
        </div>
      </Field>
      <Field label={rule.paid ? "Where you get paid" : "Where your deposit comes back"} help="A shielded address from your testnet wallet. Only the signers can read it.">
        <input name="refund" required value={refund} onChange={(e) => setRefund(e.target.value.trim())} spellCheck={false} placeholder="utest1…" className={cx(fieldCls, "text-[13.5px]")} data-testid="bid-refund" />
      </Field>
      {err && <ErrorLine testid="bid-error">{err}</ErrorLine>}
      <Btn type="submit" disabled={!!busy} full testid="bid-seal">{busy || "Seal my bid"}</Btn>
    </form>
  );
}

function Pay({ round, s, onKey, onPaid, onRestart }: { round: AuctionDetail; s: Saved; onKey: () => void; onPaid: (txid: string) => void; onRestart: () => void }) {
  const [qr, setQr] = useState("");
  const [txid, setTxid] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const b = s.bid;
  useEffect(() => { QRCode.toDataURL(b.uri, { margin: 1, width: 360, color: { dark: "#000000", light: "#f3f2ec" }, errorCorrectionLevel: "L" }).then(setQr).catch(() => setQr("")); }, [b.uri]);
  const keyFile = () => {
    const body = JSON.stringify({ benzo_bid_key: 1, auction_id: b.auction_id, ciphertext_hash: b.ciphertext_hash, deposit_address: b.address, price_zats: b.price_zats, round: b.R,
      owner_private_hex: b.owner_private_hex, owner_public_hex: b.owner_public_hex, nonce_hex: b.nonce_hex, settlement_commitment_hex: b.settlement_commitment_hex }, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    a.download = `benzo-bid-${b.ciphertext_hash.slice(0, 8)}.json`; a.click();
    onKey();
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await api.submit(round.id, { address: b.address, txid: txid.trim().toLowerCase(), envelope_hex: b.envelope_hex, envelope_ct_hex: b.envelope_ct_hex, owner_sig_hex: b.owner_sig_hex, ciphertext_hash: b.ciphertext_hash });
      onPaid(txid.trim().toLowerCase());
    } catch (x) { setErr(String((x as Error).message)); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-6">
      <div className="flex items-baseline justify-between text-[14px]">
        <span className="text-app-faint">Sealed{b.lot ? ` · ${b.lot}` : ""}</span>
        <span className="tabular-nums"><span className="text-[17px] font-semibold">{zats(b.price_zats)}</span> zats</span>
      </div>
      <div className={cx("rounded-2xl p-4", s.savedKey ? "bg-app-2" : "bg-[#2b2410]")}>
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-[14px] font-medium">{s.savedKey ? "Bid key saved" : "Save your bid key"}</div><div className="text-[13px] text-app-muted">Only needed if a refund ever has to be claimed by hand.</div></div>
          <Btn kind={s.savedKey ? "text" : "primary"} onClick={keyFile} testid="bid-key">{s.savedKey ? "Save again" : "Save"}</Btn>
        </div>
      </div>
      <div>
        <div className="text-[14px] font-medium">Pay {zec(round.C_zats)} TAZ from your wallet</div>
        <div className="mt-3 flex gap-4">
          {qr ? <img src={qr} alt="QR code for the deposit payment" className="size-[132px] shrink-0 rounded-xl" data-testid="bid-qr" /> : <div className="size-[132px] shrink-0 rounded-xl bg-app-2" />}
          <div className="grid min-w-0 content-start gap-2 text-[14px]">
            <p className="text-app-muted">Scan with a testnet wallet that supports NU7, or open the link. Send it as it is; the memo carries your sealed bid.</p>
            <a href={b.uri} className="text-app-text underline underline-offset-4" data-testid="bid-uri">Open in wallet</a>
            <button type="button" className="w-fit text-app-muted hover:text-app-text" onClick={() => navigator.clipboard.writeText(b.uri)}>Copy payment link</button>
          </div>
        </div>
      </div>
      <form onSubmit={send} className="grid gap-3">
        <Field label="Transaction id" help="Your wallet shows it after sending.">
          <input value={txid} onChange={(e) => setTxid(e.target.value.trim())} required pattern="[0-9a-fA-F]{64}" spellCheck={false} placeholder="64 characters" className={cx(fieldCls, "text-[13.5px] tabular-nums")} data-testid="bid-txid" />
        </Field>
        {err && <ErrorLine>{err}</ErrorLine>}
        <Btn type="submit" disabled={busy || !s.savedKey} full testid="bid-send">{!s.savedKey ? "Save your bid key first" : busy ? "Sending…" : "I've paid"}</Btn>
        <button type="button" onClick={onRestart} className="text-[13px] text-app-faint hover:text-app-text">Start over</button>
      </form>
      <span className="sr-only" data-testid="bid-hash">{short(b.ciphertext_hash, 8)}</span>
    </div>
  );
}

function Track({ round, s, onRestart }: { round: AuctionDetail; s: Saved; onRestart: () => void }) {
  const [st, setSt] = useState<{ status: string; detail: string; leaf_index?: number } | null>(null);
  useEffect(() => {
    let gone = false;
    const poll = () => api.bidStatus(round.id, s.bid.ciphertext_hash).then((x) => { if (!gone) setSt(x); }).catch(() => {});
    poll();
    const t = window.setInterval(poll, 10_000);
    return () => { gone = true; window.clearInterval(t); };
  }, []);
  const status = st?.status ?? "";
  const head = status === "admitted" ? "Your bid is in" : status === "refused" ? "Your bid didn't count" : "Waiting for your payment to confirm";
  const sub = status === "admitted" ? `Bid ${Number(st?.leaf_index ?? 0) + 1} of this round. It opens with the others ${rel(round.release)}.` : status === "refused" ? st?.detail : "It counts after 10 confirmations, usually 10 to 20 minutes. You can close this page.";
  return (
    <div className="grid gap-5">
      <div>
        <div className="flex items-center gap-2">{status === "admitted" ? <Pill kind="good">In</Pill> : status === "refused" ? <Pill kind="bad">Not counted</Pill> : <Pill kind="live">Confirming</Pill>}</div>
        <div className="mt-3 text-[18px] font-medium">{head}</div>
        <p className="mt-1 text-[14px] text-app-muted" data-testid="bid-status" data-status={status}>{sub}</p>
      </div>
      <dl className="grid gap-2 text-[14px]">
        <div className="flex justify-between gap-3"><dt className="text-app-faint">Price</dt><dd className="tabular-nums">{zats(s.bid.price_zats)} zats</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-app-faint">Deposit</dt><dd className="tabular-nums">{zec(round.C_zats)} TAZ sent</dd></div>
      </dl>
      <div className="grid gap-2">
        <Btn href={`/auction/?id=${round.id}&bid=${s.bid.ciphertext_hash}`} full testid="bid-follow">Follow the round</Btn>
        <button type="button" onClick={onRestart} className="text-[13px] text-app-faint hover:text-app-text">Place another bid</button>
      </div>
    </div>
  );
}
