// Your activity (after Coinbase's order history and a portfolio's activity list): every bid this browser sealed, with
// what happened to it and what to do next; the rounds it started; its invites. Outcomes come from the round's own
// record (the receipt lookup), never inferred from the round being settled. A failed check says so.
import { useEffect, useState } from "react";
import { api, MODE_NAME } from "../../lib/api";
import { glyphFor, DOOR, marketOf } from "../../lib/glyphs";
import { bids, parties, started } from "../../lib/mine";
import { Btn, Glyph, Panel, Pill, zats } from "../app/ui";
import type { AuctionDetail, RoundRequest } from "../../lib/types";

type Line = { word: string; kind: "live" | "wait" | "good" | "bad" | "plain"; next?: string };

export default function MineView() {
  const mine = bids(), rounds = started(), invites = parties().filter((p) => !rounds.some((r) => r.rid === p.rid));
  const [rounds_, setRounds] = useState<Record<string, AuctionDetail | "down">>({});
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [reqs, setReqs] = useState<Record<string, RoundRequest | "down">>({});
  const [tab, setTab] = useState<"bids" | "rounds" | "invites">(mine.length ? "bids" : rounds.length ? "rounds" : invites.length ? "invites" : "bids");
  useEffect(() => {
    for (const id of new Set(mine.map((b) => b.id))) api.auction(id).then((d) => setRounds((x) => ({ ...x, [id]: d }))).catch(() => setRounds((x) => ({ ...x, [id]: "down" })));
    for (const b of mine) {
      const set = (l: Line) => setLines((x) => ({ ...x, [b.key]: l }));
      if (b.step === "pay") { set({ word: "Deposit not recorded", kind: "live", next: "Resume" }); continue; }
      api.bidStatus(b.id, b.bid.ciphertext_hash).then(async (s) => {
        if (s.status === "refused") return set({ word: "Not counted · refundable with your recovery file", kind: "bad" });
        if (s.status !== "admitted") return set({ word: "Waiting for your deposit to confirm", kind: "wait", next: "View status" });
        // Counted: once the round has a result, say what happened to this bid.
        const r = await api.receipt(b.id, b.bid.ciphertext_hash).catch(() => null);
        const d = await api.auction(b.id).catch(() => null);
        const al = d?.result?.allocations?.find((a: any) => a.leaf_index === Number(r?.inclusion?.leaf_index));
        if (!al) return set({ word: "Counted · opens with the others", kind: "good" });
        const sells = b.bid && (d!.mode === "buyback" || d!.mode === "rfq");
        if (Number(al.fill)) set({ word: `${sells ? "Accepted" : "Won"} · ${zats(al.payment_zats)} zats ${sells ? "paid to you" : "paid"}${r?.settlement ? "" : " · payout pending"}`, kind: "good" });
        else set({ word: `Didn't win · ${r?.settlement ? `${zats(r.settlement.amount_zats)} zats refunded` : "refund pending"}`, kind: "plain" });
      }).catch(() => set({ word: "Status unavailable", kind: "bad", next: "Retry" }));
    }
    for (const r of [...rounds, ...invites]) api.request(r.rid).then((x) => setReqs((y) => ({ ...y, [r.rid]: x }))).catch(() => setReqs((y) => ({ ...y, [r.rid]: "down" })));
  }, []);
  const reqLine = (x?: RoundRequest | "down"): Line | null => !x ? null : x === "down" ? { word: "Status unavailable", kind: "bad" } : x.status === "open" ? { word: "Taking bids", kind: "live" } : x.status === "failed" ? { word: "Couldn't start", kind: "bad", next: "View reason" } : x.status === "queued" ? { word: "Setting up", kind: "wait" } : { word: `Waiting for ${x.invites.filter((i) => !i.joined).length} invited part${x.invites.filter((i) => !i.joined).length === 1 ? "y" : "ies"}`, kind: "wait", next: "Manage invites" };
  const openKey = async (f: File | undefined) => {
    if (!f) return;
    try { const k = JSON.parse(await f.text()); if (k.auction_id && k.ciphertext_hash) location.href = `/auction/?id=${k.auction_id}&bid=${k.ciphertext_hash}`; } catch { alert("That file isn't a Benzo recovery file."); }
  };
  const empty = !mine.length && !rounds.length && !invites.length;
  const tabs = [["bids", "Bids", mine.length], ["rounds", "Rounds you started", rounds.length], ["invites", "Invites", invites.length]] as const;
  return (
    <div>
      <h1>My activity</h1>
      <p className="mt-1.5 text-app-muted">Saved in this browser only. It doesn't sync, and clearing this site's data removes it.</p>
      {empty ? (
        <Panel className="mt-7 text-center">
          <div className="py-8">
            <div className="text-[17px] font-medium">No activity in this browser yet</div>
            <p className="mt-1 text-[14px] text-app-muted">Bids you seal and rounds you start here show up on this page. Have a recovery file from a bid? Open it to find that bid.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Btn href="/lots/" testid="mine-bid">Browse rounds</Btn>
              <label className="inline-flex h-10 cursor-pointer items-center rounded-full bg-[#ddd6c60d] px-5 text-[14px] font-semibold ring-1 ring-[#ddd6c62e] hover:bg-[#ddd6c61a]">Open a recovery file<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void openKey(e.target.files?.[0])} /></label>
            </div>
          </div>
        </Panel>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1" role="tablist">
              {tabs.map(([k, label, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="h-8 rounded-full px-3 text-[14px] text-app-muted hover:text-app-text aria-selected:bg-app-2 aria-selected:text-app-text">{label} <span className="tabular-nums text-app-faint">{n}</span></button>)}
            </div>
            <label className="cursor-pointer text-[14px] text-app-muted hover:text-app-text">Open a recovery file<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void openKey(e.target.files?.[0])} /></label>
          </div>
          <Panel pad={false} className="mt-4">
            {tab === "bids" && (mine.length ? (
              <ul data-testid="mine-bids">{mine.map((b) => {
                const d = rounds_[b.id], dd = d && d !== "down" ? d : null, l = lines[b.key];
                const href = b.step === "pay" || (l?.next === "View status") ? `/bid/?id=${b.id}` : `/auction/?id=${b.id}&bid=${b.bid?.ciphertext_hash ?? ""}`;
                return (
                  <li key={b.key}><a href={href} className="flex items-center gap-3 border-t border-app-line px-5 py-3.5 first:border-t-0 hover:bg-app-2">
                    <Glyph name={dd ? glyphFor(dd.mode, dd.id) : "sealed-envelope"} className="size-9" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{dd?.lot ?? "A round"}{b.bid?.lot_index !== undefined ? ` · Lot ${b.bid.lot_index + 1}` : ""}{b.archived ? <span className="text-app-faint"> · earlier attempt</span> : ""}</span><span className="block text-[13px] text-app-faint tabular-nums">{dd ? MODE_NAME[dd.mode] : ""} · your price {zats(b.bid?.price_zats ?? 0)} zats</span></span>
                    <span className="flex shrink-0 flex-col items-end gap-1">{l ? <Pill kind={l.kind}>{l.word}</Pill> : <Pill kind="plain">Checking…</Pill>}{l?.next && <span className="text-[12.5px] text-app-muted">{l.next}</span>}</span>
                  </a></li>
                );
              })}</ul>
            ) : <p className="px-5 py-6 text-[14px] text-app-muted">No bids in this browser yet.</p>)}
            {tab === "rounds" && (rounds.length ? (
              <ul data-testid="mine-rounds">{rounds.map((r) => { const l = reqLine(reqs[r.rid]); return (
                <li key={r.rid}><a href={`/round/?r=${r.rid}&t=${r.token}`} className="flex items-center gap-3 border-t border-app-line px-5 py-3.5 first:border-t-0 hover:bg-app-2">
                  <Glyph name={DOOR[marketOf(r.mode)]} className="size-9" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{r.lot}</span><span className="block text-[13px] text-app-faint">{MODE_NAME[r.mode]}</span></span>
                  <span className="flex shrink-0 flex-col items-end gap-1">{l && <Pill kind={l.kind}>{l.word}</Pill>}{l?.next && <span className="text-[12.5px] text-app-muted">{l.next}</span>}</span>
                </a></li>); })}</ul>
            ) : <p className="px-5 py-6 text-[14px] text-app-muted">You haven't started a round in this browser.</p>)}
            {tab === "invites" && (invites.length ? (
              <ul data-testid="mine-invites">{invites.map((p) => { const x = reqs[p.rid], l = reqLine(x); return (
                <li key={p.rid}><a href={`/round/?r=${p.rid}`} className="flex items-center gap-3 border-t border-app-line px-5 py-3.5 first:border-t-0 hover:bg-app-2">
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{x && x !== "down" ? x.lot : "A round"}</span><span className="block text-[13px] text-app-faint">You are the {p.label}</span></span>
                  {l && <Pill kind={l.kind}>{l.word}</Pill>}
                </a></li>); })}</ul>
            ) : <p className="px-5 py-6 text-[14px] text-app-muted">No invites in this browser.</p>)}
          </Panel>
        </>
      )}
    </div>
  );
}
