// A round someone started (after the web host's deployment view): where it is now as a list of steps, each with the thing
// to do at that step: send the invite links (OTC, RFQ), join from an invite (this browser makes the party key), fund
// the budget (buyback, RFQ), then bid.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, MODE_NAME, zec } from "../../lib/api";
import { DOOR, marketOf } from "../../lib/glyphs";
import { addParty, partyFor } from "../../lib/mine";
import { Btn, ErrorLine, Panel, Pill, cx, zats } from "../app/ui";
import type { AuctionDetail, RoundRequest } from "../../lib/types";

const WORD: Record<RoundRequest["status"], [string, "live" | "wait" | "good" | "bad"]> = { waiting: ["Waiting for parties", "wait"], queued: ["Setting up", "wait"], open: ["Taking bids", "live"], failed: ["Couldn't start", "bad"] };

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
  if (r === undefined) return <h1 className="py-16 text-[26px] text-app-muted">Loading…</h1>;
  if (r === null) return <div className="py-16"><h1 className="text-[26px]">We couldn't find this round</h1><p className="mt-2 text-app-muted">The link may be incomplete.</p><div className="mt-6"><Btn href="/start/" kind="secondary">Start a round</Btn></div></div>;

  const join = async () => {
    setErr("");
    try {
      const { newPartyKey } = await import("../../lib/bidder");
      const key = await newPartyKey();
      const x = await api.join(rid, invite!, key.public_hex);
      const p = { ...key, rid, label: inviteLabel };
      addParty(p); setMine(p); setR({ ...r, ...x });
    } catch (x) { setErr(String((x as Error).message).replace(/^./, (c) => c.toUpperCase())); }
  };
  const link = (i: { label: string; token?: string }) => `${location.origin}/round/?r=${rid}&i=${i.token}&l=${encodeURIComponent(i.label)}`;
  const joined = r.invites.filter((i) => i.joined).length, needsParties = r.invites.length > 0;
  const stage = r.status === "waiting" ? 1 : r.status === "queued" ? 2 : r.status === "open" ? 3 : -1;
  const [word, kind] = WORD[r.status];
  type S = { title: string; note?: string; state: "done" | "now" | "next" | "bad"; body?: React.ReactNode };
  const steps: S[] = [
    { title: "Round created", state: "done" },
    ...(needsParties ? [{
      title: "Invited parties join", note: `${joined} of ${r.invites.length} joined`, state: stage > 1 ? "done" : stage === 1 ? "now" : "next",
      body: stage === 1 && r.manage ? (
        <ul className="mt-3 grid gap-2" data-testid="request-invites">{r.invites.map((i) => (
          <li key={i.label} className="flex items-center justify-between gap-3 rounded-xl bg-app-2 px-3 py-2 text-[14px]">
            <span>{i.label}</span>
            {i.joined ? <Pill kind="good">Joined</Pill> : i.token && <button type="button" className="text-app-text underline-offset-4 hover:underline" onClick={() => navigator.clipboard.writeText(link(i))} data-invite={link(i)}>Copy invite link</button>}
          </li>
        ))}</ul>
      ) : stage === 1 && invite && !mine ? <div className="mt-3"><Btn onClick={join} testid="request-join">Join as {inviteLabel}</Btn></div> : undefined,
    } as S] : []),
    { title: "Set up on the signers", note: r.status === "queued" ? (r.operator === false ? "The operator is offline on this server" : r.queue ? `${r.queue} round${r.queue > 1 ? "s" : ""} ahead of yours` : "A few minutes") : r.status === "failed" ? r.error ?? "" : undefined, state: r.status === "failed" ? "bad" : stage > 2 ? "done" : stage === 2 ? "now" : "next" },
    { title: "Taking bids", note: d ? `until ${new Date(d.T_submit * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : undefined, state: stage === 3 ? "now" : "next", body: stage === 3 && d ? <Open d={d} r={r} canBid={!needsParties || Boolean(mine)} /> : undefined },
  ];
  return (
    <div data-testid="request" data-status={r.status}>
      <div className="flex flex-wrap items-center gap-3">
        <img src={`/doodles/${DOOR[marketOf(r.mode)]}.svg?v=2`} alt="" className="size-10 rounded-xl bg-app-1 p-2" />
        <h1 className="text-[28px]" data-testid="ticket-title">{r.lot}</h1>
        <Pill kind={kind}>{word}</Pill>
      </div>
      <p className="mt-1.5 text-[14px] text-app-muted">{MODE_NAME[r.mode]} · {r.lots ? r.lots.join(", ") : `${r.supply} unit${r.supply > 1 ? "s" : ""}`} · {r.minutes} minutes of bidding</p>
      <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel>
          <ol className="grid gap-0">
            {steps.map((s, i) => (
              <li key={s.title} className="relative flex gap-4 pb-6 last:pb-0">
                {i < steps.length - 1 && <span aria-hidden className={cx("absolute left-[11px] top-7 h-[calc(100%-1.75rem)] w-[2px]", s.state === "done" ? "bg-app-muted" : "bg-app-2")} />}
                <span aria-hidden className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold", s.state === "done" && "bg-app-muted text-black", s.state === "now" && "bg-gold text-black", s.state === "next" && "bg-app-2 text-app-faint", s.state === "bad" && "bg-bad text-black")}>{s.state === "done" ? "✓" : s.state === "bad" ? "!" : ""}</span>
                <div className="min-w-0 flex-1">
                  <div className={cx("text-[15px] font-medium", s.state === "next" && "text-app-muted")}>{s.title}</div>
                  {s.note && <div className={cx("text-[13.5px]", s.state === "bad" ? "text-bad" : "text-app-muted")}>{s.note}</div>}
                  {s.body}
                </div>
              </li>
            ))}
          </ol>
          {err && <div className="mt-4"><ErrorLine>{err}</ErrorLine></div>}
        </Panel>
        <aside className="grid content-start gap-4">
          {mine && <Panel><div className="flex items-center justify-between text-[14px]" data-testid="request-party"><span className="text-app-faint">You are</span><Pill kind="wait">{mine.label}</Pill></div><p className="mt-2 text-[13px] text-app-muted">Your party key stays in this browser. Bid from this device.</p></Panel>}
          <Panel>
            <dl className="grid gap-2.5 text-[14px]">
              <div className="flex justify-between"><dt className="text-app-faint">{r.mode === "buyback" || r.mode === "rfq" ? "Asks up to" : "Bids up to"}</dt><dd className="tabular-nums">{zats(r.max_price_zats)} zats</dd></div>
              {r.mode !== "otc" && r.mode !== "rfq" && r.mode !== "buyback" && <div className="flex justify-between"><dt className="text-app-faint">Reserve</dt><dd className="tabular-nums">{zats(r.reserve_zats)} zats</dd></div>}
              {r.budget_zats && <div className="flex justify-between"><dt className="text-app-faint">Budget</dt><dd className="tabular-nums">{zats(r.budget_zats)} zats</dd></div>}
              <div className="flex justify-between"><dt className="text-app-faint">Bidding time</dt><dd>{r.minutes} min</dd></div>
            </dl>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Open({ d, r, canBid }: { d: AuctionDetail; r: RoundRequest; canBid: boolean }) {
  const [qr, setQr] = useState("");
  const uri = d.funding ? `zcash:${d.funding.address}?amount=${(Number(d.funding.amount_zats) / 1e8).toFixed(8)}` : "";
  useEffect(() => { if (uri) QRCode.toDataURL(uri, { margin: 1, width: 300, color: { dark: "#000000", light: "#f3f2ec" } }).then(setQr).catch(() => {}); }, [uri]);
  return (
    <div className="mt-3 grid gap-4">
      {d.funding && r.manage && (
        <div className="flex gap-4 rounded-xl bg-[#2b2410] p-3">
          {qr ? <img src={qr} alt="QR code for the budget payment" className="size-[112px] shrink-0 rounded-lg" data-testid="request-fund-qr" /> : <div className="size-[112px] shrink-0 rounded-lg bg-app-2" />}
          <div className="grid min-w-0 content-start gap-1.5 text-[14px]">
            <div className="font-medium">Pay the {zec(d.funding.amount_zats)} TAZ budget</div>
            <p className="text-app-muted">Offers count only once the budget has arrived.</p>
            <a href={uri} className="w-fit underline underline-offset-4" data-testid="request-fund">Open in wallet</a>
            <button type="button" className="w-fit text-app-muted hover:text-app-text" onClick={() => navigator.clipboard.writeText(uri)}>Copy payment link</button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {d.live && canBid && <Btn href={`/bid/?id=${d.id}`} testid="request-bid">{d.mode === "buyback" || d.mode === "rfq" ? "Make an offer" : "Bid"}</Btn>}
        <Btn href={`/auction/?id=${d.id}`} kind="secondary" testid="request-round">Round page</Btn>
      </div>
    </div>
  );
}
