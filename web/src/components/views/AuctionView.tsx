// One round, printed on the ticket: its times, its sealed bids opened at round R, who was paid, the checks anyone can
// rerun, how to rerun them, and a lookup for your own bid's receipt.
import { useEffect, useState } from "react";
import { Ticket, Part, Row, Button } from "../page/Ticket";
import { api, MODE_NAME, STATE_LIGHT, short, thousands, utc, zec } from "../../lib/api";
import { glyphFor } from "../../lib/glyphs";
import { clock, useCountdown } from "./useCountdown";
import type { AuctionDetail } from "../../lib/types";

const TABLE_RULE = "border-t border-ink/15"; // taste-skill-ignore: rules belong to a real table

export default function AuctionView() {
  const id = typeof location !== "undefined" ? new URLSearchParams(location.search).get("id") ?? "" : "";
  const [d, setD] = useState<(AuctionDetail & { freeze?: any }) | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(id)) { setErr("This link has no auction id."); return; }
    let gone = false;
    const load = () => api.auction(id).then((x) => { if (!gone) setD(x); }).catch((e) => !gone && setErr(String(e.message)));
    load();
    const t = window.setInterval(load, 20_000);
    return () => { gone = true; window.clearInterval(t); };
  }, [id]);
  const toClose = useCountdown(d?.T_submit), toR = useCountdown(d?.release);
  if (err) return <Ticket kind="Round" title="Not found"><p className="font-serif">{err} <a className="text-moss underline" href="/lots/">See every lot.</a></p></Ticket>;
  if (!d) return <Ticket kind="Round" title="Loading…"><p className="font-serif text-muted">Reading the published auction directory.</p></Ticket>;

  const light = STATE_LIGHT[d.state] ?? STATE_LIGHT.SETTLED;
  const allocations: any[] = d.result?.allocations ?? [];
  const ok = d.checks.filter((c) => c.ok).length;
  const origin = location.origin;
  return (
    <Ticket wide kind={`${MODE_NAME[d.mode]} · ${d.supply} unit${d.supply > 1 ? "s" : ""}`} title={d.lot ?? `${MODE_NAME[d.mode]} round`} light={light} glyph={glyphFor(d.mode, d.id)}
      caption={<span data-testid="auction-caption">{d.leaf_count ?? 0} sealed bids · {zec(d.C_zats)} TAZ deposit each</span>}>
      {d.live && d.state === "OPEN" && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-sand px-4 py-3">
          <p className="font-sans text-[14px]">Taking sealed bids{toClose ? ` for ${clock(toClose)}` : ""}.</p>
          <Button href={`/bid/?id=${d.id}`} testid="auction-bid">Seal a bid</Button>
        </div>
      )}
      <Part title="When">
        <Row k="Bids close" v={`${utc(d.T_submit)}${toClose ? ` · in ${clock(toClose)}` : ""}`} />
        <Row k="Freeze cutoff" v={utc(d.T_freeze)} />
        <Row k={`Opens at drand round ${thousands(d.R)}`} v={`${utc(d.release)}${toR ? ` · in ${clock(toR)}` : ""}`} />
      </Part>
      {d.freeze_root && (
        <Part title="Frozen set">
          <Row k="Sealed bids" v={d.leaf_count ?? 0} />
          <Row k="Freeze root" v={short(d.freeze_root, 10)} />
          <Row k="Witness certificates" v={`${d.witness_certificates} of 2`} />
        </Part>
      )}
      {d.result && (
        <Part title={`Opened and cleared${d.clearing_price_zats ? ` at ${thousands(d.clearing_price_zats)} zats` : ""}`}>
          <table className="w-full font-sans text-[14px] tabular" data-testid="allocations">
            <thead className="text-left text-[13px] text-muted"><tr><th className="pb-1 font-normal">Bid</th><th className="pb-1 font-normal">Price</th><th className="pb-1 font-normal">Outcome</th><th className="pb-1 text-right font-normal">Pays</th><th className="pb-1 text-right font-normal">Refund</th></tr></thead>
            <tbody>{allocations.map((a) => (
              <tr key={a.leaf_index} className={TABLE_RULE}><td className="py-1.5">{a.leaf_index + 1}</td><td>{a.price_zats ? thousands(a.price_zats) : "–"}</td><td>{a.outcome}</td><td className="text-right">{thousands(a.payment_zats ?? 0)}</td><td className="text-right">{thousands(a.refund_zats ?? 0)}</td></tr>
            ))}</tbody>
          </table>
        </Part>
      )}
      {d.receipts.length > 0 && (
        <Part title="Paid by two of three signers">
          {d.receipts.map((r, i) => <Row key={i} k={r.party.replace(/^leaf:(\d+)$/, (_, n) => `Bid ${Number(n) + 1}`).replace(/:.*$/, "")} v={`${thousands(r.amount_zats)} zats${r.txid ? ` · ${short(r.txid, 6)}` : ""}`} />)}
        </Part>
      )}
      <Part title={`${ok} of ${d.checks.length} checks pass`}>
        <details className="font-sans text-[14px]" data-testid="checks">
          <summary className="cursor-pointer text-moss">Show checks</summary>
          <ul className="mt-2 grid gap-0.5">{d.checks.map((c) => <li key={c.id} className="flex gap-2"><span className={c.ok ? "text-moss" : "text-[#9b2c2c]"}>{c.ok ? "OK" : "ERROR"}</span><span>{c.id}</span>{c.detail && <span className="text-muted">{c.detail}</span>}</li>)}</ul>
        </details>
      </Part>
      <Part title="Run it offline">
        <pre className=" overflow-x-auto bg-sand p-3 text-[13px] leading-relaxed"><code>{`curl -sL ${origin}/api/auctions/${d.id}/public.tgz | tar -xz\nnpx -y --package=${origin}/dl/benzo-0.1.0.tgz benzo verify \\\n  --dir public-${d.id.slice(0, 8)} --signer ${d.signer}`}</code></pre>
      </Part>
      <ReceiptLookup id={d.id} frozen={Boolean(d.freeze_root)} />
    </Ticket>
  );
}

function ReceiptLookup({ id, frozen }: { id: string; frozen: boolean }) {
  const [hash, setHash] = useState(() => new URLSearchParams(location.search).get("bid") ?? "");
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState("");
  const look = async (e?: React.FormEvent) => { e?.preventDefault(); setErr(""); setOut(null); try { setOut(await api.receipt(id, hash.trim())); } catch (x) { setErr(String((x as Error).message).replace(/^[^:]+: \d+ /, "")); } };
  useEffect(() => { if (hash && frozen) void look(); }, []);
  if (!frozen) return null;
  return (
    <Part title="Find your bid">
      <form onSubmit={look} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="ct">Your bid's ciphertext hash</label>
        <input id="ct" value={hash} onChange={(e) => setHash(e.target.value)} placeholder="ciphertext hash from your bid key" className="min-w-0 flex-1 border border-ink/30 bg-white/40 px-3 py-2 font-sans text-[14px] outline-none focus:border-moss" />
        <Button type="submit" quiet>Look up</Button>
      </form>
      {err && <p className="mt-2 font-sans text-[14px] text-[#9b2c2c]">{err}</p>}
      {out && <pre className="mt-2 max-h-64 overflow-auto bg-sand p-3 text-[12.5px]" data-testid="receipt"><code>{JSON.stringify(out, null, 2)}</code></pre>}
    </Part>
  );
}
