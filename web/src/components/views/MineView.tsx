// Everything this browser did (after a trading app's portfolio): the bids it sealed and where each stands, the rounds it
// started, its invites. Each row says what to do next, if anything.
import { useEffect, useState } from "react";
import { api, MODE_NAME, STATE_LIGHT } from "../../lib/api";
import { glyphFor, DOOR, marketOf } from "../../lib/glyphs";
import { bids, parties, started } from "../../lib/mine";
import { Btn, Panel, Pill, zats } from "../app/ui";
import type { AuctionSummary, RoundRequest } from "../../lib/types";

export default function MineView() {
  const [list, setList] = useState<AuctionSummary[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [reqs, setReqs] = useState<Record<string, RoundRequest>>({});
  const mine = bids(), rounds = started(), invites = parties().filter((p) => !rounds.some((r) => r.rid === p.rid));
  const [tab, setTab] = useState<"bids" | "rounds" | "invites">(mine.length ? "bids" : rounds.length ? "rounds" : invites.length ? "invites" : "bids");
  useEffect(() => {
    api.auctions().then(setList).catch(() => {});
    for (const b of mine) if (b.bid?.ciphertext_hash && b.step === "track") api.bidStatus(b.id, b.bid.ciphertext_hash).then((s) => setStatus((x) => ({ ...x, [b.id]: s.status }))).catch(() => {});
    for (const r of [...rounds, ...invites]) api.request(r.rid).then((x) => setReqs((y) => ({ ...y, [r.rid]: x }))).catch(() => {});
  }, []);
  const of = (id: string) => list.find((a) => a.id === id);
  const empty = !mine.length && !rounds.length && !invites.length;
  const tabs = [["bids", "Bids", mine.length], ["rounds", "Rounds you started", rounds.length], ["invites", "Invites", invites.length]] as const;
  const reqWord = (x?: RoundRequest) => !x ? "" : x.status === "open" ? "Taking bids" : x.status === "failed" ? "Couldn't start" : x.status === "queued" ? "Setting up" : "Waiting for parties";
  return (
    <div>
      <h1 className="text-[28px]">Mine</h1>
      <p className="mt-1.5 text-app-muted">Bids and rounds from this browser.</p>
      {empty ? (
        <Panel className="mt-7 text-center">
          <div className="py-8">
            <div className="text-[17px] font-medium">Nothing here yet</div>
            <p className="mt-1 text-[14px] text-app-muted">Bids you seal and rounds you start on this device show up here.</p>
            <div className="mt-5 flex justify-center gap-3"><Btn href="/" testid="mine-bid">Find a round</Btn><Btn href="/start/" kind="secondary">Start a round</Btn></div>
          </div>
        </Panel>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-1" role="tablist">
            {tabs.map(([k, label, n]) => n > 0 && <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="h-8 rounded-full px-3 text-[14px] text-app-muted hover:text-app-text aria-selected:bg-app-2 aria-selected:text-app-text">{label} <span className="tabular-nums text-app-faint">{n}</span></button>)}
          </div>
          <Panel pad={false} className="mt-4">
            {tab === "bids" && (
              <ul data-testid="mine-bids">{mine.map((b) => {
                const a = of(b.id), st = status[b.id];
                const [word, kind] = b.step === "pay" ? ["Not paid", "live"] as const : st === "admitted" ? [a ? (STATE_LIGHT[a.state]?.word === "Open" ? "In the round" : STATE_LIGHT[a.state]?.word ?? "In the round") : "In the round", "good"] as const : st === "refused" ? ["Didn't count", "bad"] as const : ["Confirming", "wait"] as const;
                const href = b.step === "pay" || (a?.live && st !== "admitted") ? `/bid/?id=${b.id}` : `/auction/?id=${b.id}&bid=${b.bid?.ciphertext_hash ?? ""}`;
                return (
                  <li key={b.id}><a href={href} className="flex items-center gap-3 border-t border-app-line px-5 py-3.5 first:border-t-0 hover:bg-app-2">
                    <img src={`/doodles/${a ? glyphFor(a.mode, a.id) : "sealed-envelope"}.svg`} alt="" className="size-8 shrink-0 rounded-lg bg-app-2 p-1.5" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{a?.lot ?? "A round"}{b.bid?.lot ? ` · ${b.bid.lot}` : ""}</span><span className="block text-[13px] text-app-faint tabular-nums">{a ? MODE_NAME[a.mode] : ""} · {zats(b.bid?.price_zats ?? 0)} zats</span></span>
                    <Pill kind={kind}>{word}</Pill>
                  </a></li>
                );
              })}</ul>
            )}
            {tab === "rounds" && (
              <ul data-testid="mine-rounds">{rounds.map((r) => (
                <li key={r.rid}><a href={`/round/?r=${r.rid}&t=${r.token}`} className="flex items-center gap-3 border-t border-app-line px-5 py-3.5 first:border-t-0 hover:bg-app-2">
                  <img src={`/doodles/${DOOR[marketOf(r.mode)]}.svg`} alt="" className="size-8 shrink-0 rounded-lg bg-app-2 p-1.5" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{r.lot}</span><span className="block text-[13px] text-app-faint">{MODE_NAME[r.mode]}</span></span>
                  {reqs[r.rid] && <Pill kind={reqs[r.rid].status === "open" ? "live" : reqs[r.rid].status === "failed" ? "bad" : "wait"}>{reqWord(reqs[r.rid])}</Pill>}
                </a></li>
              ))}</ul>
            )}
            {tab === "invites" && (
              <ul data-testid="mine-invites">{invites.map((p) => (
                <li key={p.rid}><a href={`/round/?r=${p.rid}`} className="flex items-center gap-3 border-t border-app-line px-5 py-3.5 first:border-t-0 hover:bg-app-2">
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{reqs[p.rid]?.lot ?? "A round"}</span><span className="block text-[13px] text-app-faint">You are {p.label}</span></span>
                  {reqs[p.rid] && <Pill kind={reqs[p.rid].status === "open" ? "live" : "wait"}>{reqWord(reqs[p.rid])}</Pill>}
                </a></li>
              ))}</ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
