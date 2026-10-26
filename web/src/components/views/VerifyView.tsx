// Verify any round (after GitHub's checks): the checks run on the round's published record, listed in plain words, with
// one line that says whether the round checks out. Beside them: which round, and the record to download.
import { useEffect, useState } from "react";
import { api, MODE_NAME } from "../../lib/api";
import { Btn, ErrorLine, Field, Panel, Pill, Tick, checkName, cx, fieldCls, when } from "../app/ui";
import type { AuctionDetail } from "../../lib/types";

export default function VerifyView({ recent }: { recent: { id: string; lot: string | null; mode: string }[] }) {
  const [id, setId] = useState(() => new URLSearchParams(location.search).get("id") ?? recent[0]?.id ?? "");
  const [paste, setPaste] = useState("");
  const [d, setD] = useState<AuctionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (which = id) => {
    setErr(""); setBusy(true);
    if (!/^[0-9a-f]{64}$/.test(which.trim())) { setErr("A round id is 64 letters and digits. Copy it from the round's page."); setBusy(false); return; }
    try { const x = await api.auction(which.trim()); setD(x); setId(x.id); history.replaceState(history.state, "", `/verify/?id=${x.id}`); } catch { setErr("There's no round with that id."); } finally { setBusy(false); }
  };
  useEffect(() => { if (id) void run(); }, []);
  const ok = d ? d.checks.filter((c) => c.ok).length : 0;
  const known = recent.some((r) => r.id === id);
  return (
    <div>
      <h1 className="text-[28px]">Verify a round</h1>
      <p className="mt-1.5 text-app-muted">Every check is rerun on the round's public record. Nothing here takes our word for it.</p>
      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          {!d ? <div className="py-10 text-center text-app-muted">{busy ? "Running the checks…" : "Pick a round to check."}</div> : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[19px] font-semibold">{ok} of {d.checks.length} checks pass</div>
                  <div className="truncate text-[14px] text-app-muted">{d.lot ?? MODE_NAME[d.mode]} · {MODE_NAME[d.mode]} · {when(d.updated)}</div>
                </div>
                <Pill kind={d.valid ? "good" : "bad"}>{d.valid ? "Checks out" : "Does not verify"}</Pill>
              </div>
              <ul className="mt-5" data-testid="verify-results">{d.checks.map((c) => (
                <li key={c.id} className="flex gap-3 border-t border-app-line py-3 text-[14.5px]">
                  <Tick ok={c.ok} />
                  <span className="min-w-0 flex-1">{checkName(c.id)}{c.detail && !c.ok && <span className="block text-[13px] text-bad">{c.detail}</span>}</span>
                </li>
              ))}</ul>
            </>
          )}
        </Panel>
        <aside className="grid content-start gap-4">
          <Panel>
            <Field label="Round">
              <select value={known ? id : ""} onChange={(e) => { setId(e.target.value); void run(e.target.value); }} className={fieldCls} aria-label="Recent settled rounds">
                {!known && <option value="">Pasted round</option>}
                {recent.map((r) => <option key={r.id} value={r.id}>{r.lot ?? MODE_NAME[r.mode]} · {MODE_NAME[r.mode]}</option>)}
              </select>
            </Field>
            <form onSubmit={(e) => { e.preventDefault(); void run(paste); }} className="mt-4 grid gap-2">
              <Field label="Or paste a round id">
                <input value={paste} onChange={(e) => setPaste(e.target.value.trim())} spellCheck={false} placeholder="64 characters" className={cx(fieldCls, "text-[13.5px] tabular-nums")} />
              </Field>
              <Btn type="submit" kind="secondary" disabled={busy} testid="verify-run">{busy ? "Checking…" : "Run the checks"}</Btn>
            </form>
            {err && <div className="mt-3"><ErrorLine>{err}</ErrorLine></div>}
          </Panel>
          {d && (
            <Panel>
              <div className="text-[15px] font-medium">Check it yourself</div>
              <p className="mt-1 text-[14px] text-app-muted">Download the round's public record and run Benzo's open-source verifier on it.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Btn href={`/api/auctions/${d.id}/public.tgz`} kind="secondary">Download the record</Btn>
                <Btn href={`/auction/?id=${d.id}`} kind="text">Open the round</Btn>
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
