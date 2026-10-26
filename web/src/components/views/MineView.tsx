// Everything this browser did: the bids it sealed (and where each stands), the rounds it started, its party invites.
import { useEffect, useState } from "react";
import { Ticket, Part, Button } from "../page/Ticket";
import { api, MODE_NAME, short, STATE_LIGHT, thousands } from "../../lib/api";
import { bids, parties, started } from "../../lib/mine";
import type { AuctionSummary } from "../../lib/types";

const row = "flex min-h-[44px] items-center justify-between gap-3 font-sans text-[14px]";

export default function MineView() {
  const [list, setList] = useState<AuctionSummary[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [reqs, setReqs] = useState<Record<string, string>>({});
  const mine = bids(), rounds = started(), invites = parties().filter((p) => !rounds.some((r) => r.rid === p.rid));
  useEffect(() => {
    api.auctions().then(setList).catch(() => {});
    for (const b of mine) if (b.bid?.ciphertext_hash && b.step === "track") api.bidStatus(b.id, b.bid.ciphertext_hash).then((s) => setStatus((x) => ({ ...x, [b.id]: s.status }))).catch(() => {});
    for (const r of [...rounds, ...invites]) api.request(r.rid).then((x) => setReqs((y) => ({ ...y, [r.rid]: x.status === "open" ? "Open" : x.status === "failed" ? "Could not start" : x.status === "queued" ? "Starting" : "Waiting for parties" }))).catch(() => {});
  }, []);
  const of = (id: string) => list.find((a) => a.id === id);
  const empty = !mine.length && !rounds.length && !invites.length;
  return (
    <Ticket kind="Mine" title="Mine" wide>
      {empty && <div className="flex flex-wrap gap-4"><Button href="/bid/" testid="mine-bid">Bid</Button><Button quiet href="/start/">Start a round</Button></div>}
      {mine.length > 0 && (
        <Part title="Bids">
          <ul data-testid="mine-bids">{mine.map((b) => {
            const a = of(b.id), state = a ? (STATE_LIGHT[a.state]?.word ?? a.state) : "";
            const where = b.step === "pay" ? "Not paid yet" : status[b.id] === "admitted" ? `In · ${state}` : status[b.id] === "refused" ? "Not admitted" : "Waiting for confirmations";
            return (
              <li key={b.id}><a className={`${row} hover:text-moss`} href={b.step === "pay" || (a?.live && status[b.id] !== "admitted") ? `/bid/?id=${b.id}` : `/auction/?id=${b.id}&bid=${b.bid?.ciphertext_hash ?? ""}`}>
                <span className="min-w-0 truncate">{a?.lot ?? short(b.id, 6)}{b.bid?.lot ? ` · ${b.bid.lot}` : ""} <span className="text-muted">{a ? MODE_NAME[a.mode] : ""} · {thousands(b.bid?.price_zats ?? 0)} zats</span></span>
                <span className="shrink-0 text-muted">{where}</span>
              </a></li>
            );
          })}</ul>
        </Part>
      )}
      {rounds.length > 0 && (
        <Part title="Rounds you started">
          <ul data-testid="mine-rounds">{rounds.map((r) => (
            <li key={r.rid}><a className={`${row} hover:text-moss`} href={`/round/?r=${r.rid}&t=${r.token}`}>
              <span className="min-w-0 truncate">{r.lot} <span className="text-muted">{MODE_NAME[r.mode]}</span></span><span className="shrink-0 text-muted">{reqs[r.rid] ?? ""}</span>
            </a></li>
          ))}</ul>
        </Part>
      )}
      {invites.length > 0 && (
        <Part title="Invites">
          <ul data-testid="mine-invites">{invites.map((p) => (
            <li key={p.rid}><a className={`${row} hover:text-moss`} href={`/round/?r=${p.rid}`}><span>{p.label}</span><span className="text-muted">{reqs[p.rid] ?? ""}</span></a></li>
          ))}</ul>
        </Part>
      )}
    </Ticket>
  );
}
