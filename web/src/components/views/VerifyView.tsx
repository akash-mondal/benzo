// Verify any round: the gateway runs the same checks `benzo verify` runs over the published directory; the ticket
// lists them and gives the commands to run them yourself, offline.
import { useState } from "react";
import { Ticket, Part, Button } from "../page/Ticket";
import { api, MODE_NAME } from "../../lib/api";
import type { AuctionDetail } from "../../lib/types";

export default function VerifyView({ recent }: { recent: { id: string; lot: string | null; mode: string }[] }) {
  const [id, setId] = useState(() => new URLSearchParams(location.search).get("id") ?? recent[0]?.id ?? "");
  const [d, setD] = useState<AuctionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (e?: React.FormEvent) => {
    e?.preventDefault(); setErr(""); setD(null); setBusy(true);
    try { setD(await api.auction(id.trim())); } catch (x) { setErr(String((x as Error).message)); } finally { setBusy(false); }
  };
  const ok = d ? d.checks.filter((c) => c.ok).length : 0;
  return (
    <Ticket kind="Verify" title="Check a round yourself" glyph="magnifier" caption="the same checks benzo verify runs" sub="Pick any round that ran on Zcash testnet and rerun every check on its published directory.">
      <Part title="Pick a round">
        <form onSubmit={run} className="grid gap-2">
          <label className="sr-only" htmlFor="pick">Recent settled rounds</label>
          <select id="pick" value={id} onChange={(e) => setId(e.target.value)} className="border border-ink/30 bg-white/40 px-3 py-2 font-sans text-[14px]">
            {recent.map((r) => <option key={r.id} value={r.id}>{r.lot ?? MODE_NAME[r.mode]} · {r.id.slice(0, 8)}</option>)}
          </select>
          <label className="sr-only" htmlFor="vid">Or paste an auction id</label>
          <input id="vid" value={id} onChange={(e) => setId(e.target.value)} className="border border-ink/30 bg-white/40 px-3 py-2 font-sans text-[14px] tabular" />
          <div><Button type="submit" disabled={busy} testid="verify-run">{busy ? "Checking…" : "Run the checks"}</Button></div>
        </form>
      </Part>
      {err && <p className="mt-4 font-sans text-[14px] text-[#9b2c2c]">{err}</p>}
      {d && (
        <>
          <Part title={`${ok} of ${d.checks.length} checks pass${d.valid ? "" : " — this round does not verify"}`}>
            <ul className="grid gap-0.5 font-sans text-[14px]" data-testid="verify-results">{d.checks.map((c) => <li key={c.id} className="flex gap-2"><span className={c.ok ? "text-moss" : "text-[#9b2c2c]"}>{c.ok ? "OK" : "ERROR"}</span><span>{c.id}</span>{c.detail && <span className="text-muted">{c.detail}</span>}</li>)}</ul>
          </Part>
          <Part title="Don't take our word for it">
            <p>These ran on this site's server. The same verifier ships as an npm package that rebuilds byte for byte from the source; run it offline:</p>
            <pre className="mt-2 overflow-x-auto bg-sand p-3 text-[13px] leading-relaxed"><code>{`curl -sL ${location.origin}/api/auctions/${d.id}/public.tgz | tar -xz\nnpx -y --package=${location.origin}/dl/benzo-0.1.0.tgz benzo verify \\\n  --dir public-${d.id.slice(0, 8)} --signer ${d.signer}`}</code></pre>
            <p className="mt-3"><a className="text-moss underline underline-offset-4" href={`/auction/?id=${d.id}`}>Open this round</a></p>
          </Part>
        </>
      )}
    </Ticket>
  );
}
