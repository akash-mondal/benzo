// A round someone started: its status until the operator opens it, the invite links its creator sends (OTC, RFQ),
// joining from an invite (this browser makes the party key), funding the budget (buyback, RFQ), then bidding.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Ticket, Part, Row, Button } from "../page/Ticket";
import { api, MODE_NAME, thousands, zec } from "../../lib/api";
import { DOOR, marketOf } from "../../lib/glyphs";
import { addParty, partyFor } from "../../lib/mine";
import type { AuctionDetail, RoundRequest } from "../../lib/types";

const WORD: Record<RoundRequest["status"], string> = { waiting: "Waiting for parties", queued: "Starting", open: "Open", failed: "Could not start" };

export default function RequestView() {
  const q = new URLSearchParams(location.search), rid = q.get("r") ?? "", token = q.get("t"), invite = q.get("i"), inviteLabel = q.get("l") ?? "Party";
  const [r, setR] = useState<RoundRequest | null | undefined>(undefined);
  const [d, setD] = useState<AuctionDetail | null>(null);
  const [mine, setMine] = useState(partyFor(rid));
  const [err, setErr] = useState("");
  useEffect(() => {
    let gone = false;
    const load = () => api.request(rid, token).then(async (x) => { if (gone) return; setR(x); if (x.auction_id) setD(await api.auction(x.auction_id).catch(() => null)); }).catch(() => !gone && setR(null));
    load();
    const t = window.setInterval(load, 10_000);
    return () => { gone = true; window.clearInterval(t); };
  }, []);
  if (r === undefined) return <Ticket kind="Round" title="Loading…" />;
  if (r === null) return <Ticket kind="Round" title="Unknown round"><Button quiet href="/start/">Start a round</Button></Ticket>;

  const join = async () => {
    setErr("");
    try {
      const { newPartyKey } = await import("../../lib/bidder");
      const key = await newPartyKey();
      const x = await api.join(rid, invite!, key.public_hex);
      const p = { ...key, rid, label: inviteLabel };
      addParty(p); setMine(p); setR({ ...r, ...x });
    } catch (x) { setErr(String((x as Error).message)); }
  };
  const link = (i: { label: string; token?: string }) => `${location.origin}/round/?r=${rid}&i=${i.token}&l=${encodeURIComponent(i.label)}`;
  const joined = r.invites.filter((i) => i.joined).length;
  return (
    <Ticket kind={`${MODE_NAME[r.mode]} · ${WORD[r.status]}`} title={r.lot} glyph={DOOR[marketOf(r.mode)]}
      light={{ word: WORD[r.status], color: r.status === "open" ? "bg-[#9fd36b]" : r.status === "failed" ? "bg-[#c0504d]" : "bg-sand" }}
      caption={r.invites.length ? <span>{joined} of {r.invites.length} joined</span> : r.lots ? <span>{r.lots.join(" · ")}</span> : <span>{r.supply} unit{r.supply > 1 ? "s" : ""}</span>}>
      <div data-testid="request" data-status={r.status}>
        {mine && <Row k="You are" v={mine.label} testid="request-party" />}
        {invite && !mine && r.status === "waiting" && (
          <Part title={`Join as ${inviteLabel}`}><Button onClick={join} testid="request-join">Join</Button></Part>
        )}
        {r.manage && r.invites.length > 0 && (
          <Part title="Invite links">
            <ul className="grid gap-2 font-sans text-[14px]" data-testid="request-invites">
              {r.invites.map((i) => (
                <li key={i.label} className="flex items-center justify-between gap-3">
                  <span>{i.label}{i.joined ? " · joined" : ""}</span>
                  {!i.joined && i.token && <button type="button" className="text-moss underline-offset-4 hover:underline" onClick={() => navigator.clipboard.writeText(link(i))} data-invite={link(i)}>Copy link</button>}
                </li>
              ))}
            </ul>
          </Part>
        )}
        {r.status === "queued" && <Part title="Starting">{r.operator === false ? <p className="font-sans text-[14px] text-muted">The operator is offline on this server.</p> : <Row k="Rounds ahead" v={String(r.queue ?? 0)} />}</Part>}
        {r.status === "failed" && <Part title="Could not start"><p className="font-sans text-[14px] text-[#9b2c2c]">{r.error}</p></Part>}
        {r.status === "open" && d && <Open d={d} r={r} canBid={!r.invites.length || Boolean(mine)} />}
        {err && <p className="mt-3 font-sans text-[14px] text-[#9b2c2c]">{err}</p>}
      </div>
    </Ticket>
  );
}

function Open({ d, r, canBid }: { d: AuctionDetail; r: RoundRequest; canBid: boolean }) {
  const [qr, setQr] = useState("");
  const uri = d.funding ? `zcash:${d.funding.address}?amount=${(Number(d.funding.amount_zats) / 1e8).toFixed(8)}` : "";
  useEffect(() => { if (uri) QRCode.toDataURL(uri, { margin: 1, width: 300, color: { dark: "#2a2a26", light: "#d2cab8" } }).then(setQr).catch(() => {}); }, [uri]);
  return (
    <>
      {d.funding && r.manage && (
        <Part title={`Fund the budget · ${zec(d.funding.amount_zats)} TAZ`}>
          <div className="grid items-start gap-4 sm:grid-cols-[150px_1fr]">
            {qr ? <img src={qr} alt="QR code of the budget payment" className="size-[150px]" data-testid="request-fund-qr" /> : <div className="size-[150px] bg-sand" />}
            <div className="grid gap-2 font-sans text-[14px]">
              <a href={uri} className="break-all text-moss underline underline-offset-4" data-testid="request-fund">{thousands(d.funding.amount_zats)} zats</a>
              <button type="button" className="w-fit text-moss underline-offset-4 hover:underline" onClick={() => navigator.clipboard.writeText(uri)}>Copy the payment link</button>
            </div>
          </div>
        </Part>
      )}
      <div className="mt-6 flex flex-wrap gap-4">
        {d.live && canBid && <Button href={`/bid/?id=${d.id}`} testid="request-bid">{d.mode === "buyback" || d.mode === "rfq" ? "Make an offer" : "Bid"}</Button>}
        <Button quiet href={`/auction/?id=${d.id}`} testid="request-round">Round page</Button>
      </div>
    </>
  );
}
