// Seal a bid in the live round. The price and the refund address stay in this page: it seals the price to round R with
// the shipped sealer, seals the refund address to the three signers, and sends the operator only the sealed record of
// a deposit you pay from your own wallet. Your bid key (the one-time owner key) is yours to keep: it signs any claim.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Ticket, Part, Row, Button } from "../page/Ticket";
import { api, short, thousands, utc, zec } from "../../lib/api";
import { glyphFor } from "../../lib/glyphs";
import { clock, useCountdown } from "./useCountdown";
import type { AuctionSummary } from "../../lib/types";

type Saved = { step: "pay" | "track"; bid: any; txid?: string; savedKey?: boolean };
const store = (id: string) => `benzo:bid:${id}`;
const field = "w-full border border-ink/30 bg-white/50 px-3 py-2.5 font-sans text-[15px] text-ink outline-none focus:border-moss";

export default function BidView() {
  const q = new URLSearchParams(location.search);
  const [round, setRound] = useState<AuctionSummary | null | undefined>(undefined);
  const [saved, setSaved] = useState<Saved | null>(null);
  useEffect(() => {
    api.auctions().then((list) => {
      const pick = list.find((a) => a.id === q.get("id") && a.live) ?? list.find((a) => a.live && a.state === "OPEN") ?? null;
      setRound(pick);
      if (pick) { const s = localStorage.getItem(store(pick.id)); if (s) setSaved(JSON.parse(s)); }
    }).catch(() => setRound(null));
  }, []);
  const keep = (s: Saved | null) => { setSaved(s); if (round) s ? localStorage.setItem(store(round.id), JSON.stringify(s)) : localStorage.removeItem(store(round.id)); };
  const left = useCountdown(round?.T_submit);

  if (round === undefined) return <Ticket kind="Bid" title="Finding the live round…" />;
  if (!round) return (
    <Ticket kind="Bid" title="No round open" glyph="hourglass" caption="next round soon">
      <p className="font-sans text-[14px]"><a className="text-moss underline underline-offset-4" href="/lots/">Every lot</a></p>
    </Ticket>
  );
  return (
    <Ticket kind={`Live round · bids close ${utc(round.T_submit)}`} title={round.lot ?? "Live round"} glyph={glyphFor(round.mode, round.id)}
      light={{ word: left ? `${clock(left)} left` : "Closed", color: left ? "bg-[#9fd36b]" : "bg-muted" }}
      caption={<span>{round.leaf_count ?? 0} sealed so far · deposit {zec(round.C_zats)} TAZ · opens at round {thousands(round.R)}</span>}>
      {!saved && <Form round={round} onSealed={(bid) => keep({ step: "pay", bid })} />}
      {saved?.step === "pay" && <Pay round={round} s={saved} onKey={() => keep({ ...saved, savedKey: true })} onPaid={(txid) => keep({ ...saved, step: "track", txid })} onRestart={() => keep(null)} />}
      {saved?.step === "track" && <Track round={round} s={saved} onRestart={() => keep(null)} />}
    </Ticket>
  );
}

function Form({ round, onSealed }: { round: AuctionSummary; onSealed: (bid: any) => void }) {
  const q = new URLSearchParams(location.search);
  const [price, setPrice] = useState(q.get("price") ?? "");
  const [refund, setRefund] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try {
      setBusy("Taking a deposit slot…");
      const slot = await api.slot(round.id);
      setBusy("Checking the operator's signature on the round…");
      const packet = await api.packet(round.id);
      setBusy("Sealing your price to round R…");
      const { prepareSealedBid } = await import("../../lib/bidder");
      const bid = await prepareSealedBid({ packet: packet.manifest, signer: packet.signer, address: slot.address, price_zats: price.trim(), refund_ua: refund.trim() });
      onSealed(bid);
    } catch (x) { setErr(String((x as Error).message)); } finally { setBusy(""); }
  };
  return (
    <form onSubmit={go} className="grid gap-5" data-testid="bid-form">
      <Part title="Your price">
        <label className="grid gap-1.5 font-sans text-[13px] text-muted">Price per unit, in zats (100 to 3,000, in steps of 10)
          <input name="price" inputMode="numeric" required value={price} onChange={(e) => setPrice(e.target.value)} className={`${field} tabular`} data-testid="bid-price" />
        </label>
      </Part>
      <Part title="Where your refund goes">
        <label className="grid gap-1.5 font-sans text-[13px] text-muted">A shielded testnet address from your wallet (utest1…)
          <input name="refund" required value={refund} onChange={(e) => setRefund(e.target.value)} spellCheck={false} className={`${field} text-[13px]`} data-testid="bid-refund" />
        </label>
      </Part>
      {err && <p className="font-sans text-[14px] text-[#9b2c2c]" data-testid="bid-error">{err}</p>}
      <div className="flex items-center gap-4"><Button type="submit" disabled={!!busy} testid="bid-seal">{busy || "Seal my price"}</Button></div>
    </form>
  );
}

function Pay({ round, s, onKey, onPaid, onRestart }: { round: AuctionSummary; s: Saved; onKey: () => void; onPaid: (txid: string) => void; onRestart: () => void }) {
  const [qr, setQr] = useState("");
  const [txid, setTxid] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const b = s.bid;
  useEffect(() => { QRCode.toDataURL(b.uri, { margin: 1, width: 360, color: { dark: "#2a2a26", light: "#d2cab8" }, errorCorrectionLevel: "L" }).then(setQr).catch(() => setQr("")); }, [b.uri]);
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
    <div className="grid gap-2">
      <Part title="Sealed">
        <Row k="Price" v={`${thousands(b.price_zats)} zats, sealed to round ${thousands(b.R)}`} />
        <Row k="Bid (ciphertext hash)" v={short(b.ciphertext_hash, 8)} testid="bid-hash" />
      </Part>
      <Part title="Save your bid key first">
        <div><Button onClick={keyFile} quiet={!!s.savedKey} testid="bid-key">{s.savedKey ? "Saved. Save again" : "Save my bid key"}</Button></div>
      </Part>
      <Part title={`Pay the ${zec(round.C_zats)} TAZ deposit`}>
        <div className="grid items-start gap-4 sm:grid-cols-[180px_1fr]">
          {qr ? <img src={qr} alt="QR code of the deposit payment" className="size-[180px]" data-testid="bid-qr" /> : <div className="size-[180px] bg-sand" />}
          <div className="grid gap-2 font-sans text-[14px]">
            <p className="font-sans text-[13px] text-muted">NU7 testnet wallet · memo unchanged</p>
            <a href={b.uri} className="break-all text-moss underline underline-offset-4" data-testid="bid-uri">{short(b.uri.replace(/^zcash:/, ""), 18)}</a>
            <button type="button" className="w-fit text-left text-moss underline-offset-4 hover:underline" onClick={() => navigator.clipboard.writeText(b.uri)}>Copy the payment link</button>
          </div>
        </div>
      </Part>
      <Part title="Then tell the operator">
        <form onSubmit={send} className="grid gap-2">
          <label className="grid gap-1.5 font-sans text-[13px] text-muted">The transaction id your wallet shows
            <input value={txid} onChange={(e) => setTxid(e.target.value)} required pattern="[0-9a-fA-F]{64}" spellCheck={false} className={`${field} text-[13px] tabular`} data-testid="bid-txid" />
          </label>
          {err && <p className="font-sans text-[14px] text-[#9b2c2c]">{err}</p>}
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" disabled={busy || !s.savedKey} testid="bid-send">{s.savedKey ? (busy ? "Sending…" : "Send the sealed record") : "Save your bid key to continue"}</Button>
            <Button quiet onClick={onRestart}>Start over</Button>
          </div>
        </form>
      </Part>
    </div>
  );
}

function Track({ round, s, onRestart }: { round: AuctionSummary; s: Saved; onRestart: () => void }) {
  const [st, setSt] = useState<{ status: string; detail: string; leaf_index?: number } | null>(null);
  useEffect(() => {
    let gone = false;
    const poll = () => api.bidStatus(round.id, s.bid.ciphertext_hash).then((x) => { if (!gone) setSt(x); }).catch(() => {});
    poll();
    const t = window.setInterval(poll, 10_000);
    return () => { gone = true; window.clearInterval(t); };
  }, []);
  const word = st?.status === "admitted" ? "Admitted" : st?.status === "refused" ? "Not admitted" : "Waiting for confirmations";
  return (
    <div>
      <Part title={word}>
        <p data-testid="bid-status" data-status={st?.status ?? ""}>{st?.detail ?? "Asking the operator…"}</p>
        <Row k="Deposit transaction" v={short(s.txid ?? "", 8)} />
        <Row k="Bid" v={short(s.bid.ciphertext_hash, 8)} />
      </Part>
      <Part title="Next">
        <Row k="Opens" v={`round ${thousands(round.R)} · ${utc(round.release)}`} />
        <div className="mt-3 flex flex-wrap gap-4">
          <Button href={`/auction/?id=${round.id}&bid=${s.bid.ciphertext_hash}`} testid="bid-follow">Follow this round</Button>
          <Button quiet onClick={onRestart}>Seal another bid</Button>
        </div>
      </Part>
    </div>
  );
}
