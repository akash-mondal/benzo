// Verify any round (after GitHub's checks, Sigstore's verification docs): pick the round first, then one attempt bound to
// that round: its target, its status, its verdict, its checks grouped by what they establish. A failed or new attempt
// replaces the result; an old green verdict never stands beside a different round. The page says plainly what the
// service's checks establish and what they don't, and how to run them yourself.
import { useEffect, useRef, useState } from "react";
import { api, MODE_NAME, short } from "../../lib/api";
import { Btn, ErrorLine, Field, Panel, Pill, Tick, checkName, cx, fieldCls, when } from "../app/ui";
import type { AuctionDetail, Check } from "../../lib/types";

const GROUPS: [string, string[]][] = [
  ["The round's terms", ["manifest"]],
  ["Which bids were in, and that they were fixed before opening", ["freeze", "witness", "receipts", "missing-deposits"]],
  ["The opening and the result", ["clear", "report", "projection"]],
  ["The payments", ["accounting", "accounting-strays", "receipt-attestation", "balances", "balance-refs", "defaults", "claims"]],
  ["Privacy of what was published", ["envelope", "no-destinations"]],
  ["Launch deliveries", ["delivery", "delivery-list"]],
];
type Attempt = { target: string; status: "checking" | "done" | "missing" | "unavailable" | "bad"; d?: AuctionDetail };

export default function VerifyView({ recent }: { recent: { id: string; lot: string | null; mode: string }[] }) {
  const [id, setId] = useState(() => new URLSearchParams(location.search).get("id") ?? recent[0]?.id ?? "");
  const [paste, setPaste] = useState("");
  const [a, setA] = useState<Attempt | null>(null);
  const seq = useRef(0);
  const run = async (target = id) => {
    const t = target.trim(), n = ++seq.current;
    if (!/^[0-9a-f]{64}$/.test(t)) { setA({ target: t, status: "bad" }); return; }
    setA({ target: t, status: "checking" }); setId(t);
    history.replaceState(history.state, "", `/verify/?id=${t}`);
    try { const d = await api.auction(t); if (n === seq.current) setA({ target: t, status: "done", d }); }
    catch (e) { if (n === seq.current) setA({ target: t, status: /: 404 /.test(String((e as Error).message)) ? "missing" : "unavailable" }); }
  };
  useEffect(() => { if (id) void run(); }, []);
  const known = recent.some((r) => r.id === id);
  const d = a?.status === "done" ? a.d! : null;
  const by = (ids: string[]) => (d?.checks ?? []).filter((c) => ids.includes(c.id));
  const leftovers = (d?.checks ?? []).filter((c) => !GROUPS.some(([, ids]) => ids.includes(c.id)));
  const failed = (d?.checks ?? []).filter((c) => c.status === "failed" || (!c.ok && !c.status));
  const counted = (d?.checks ?? []).filter((c) => c.status !== "not_applicable");
  return (
    <div>
      <h1>Verify a round</h1>
      <p className="mt-1.5 max-w-[640px] text-app-muted">Check a round's public record: its terms, which bids were in, how they opened and cleared, and the payments.</p>
      {/* Phone: picker, result, then the notes. Desktop: picker and notes left, result right. */}
      <div className="mt-8 grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
          <Panel className="self-start lg:col-start-1 lg:row-start-1">
            <Field label="Round">
              <select value={known ? id : ""} onChange={(e) => { if (e.target.value) void run(e.target.value); }} className={fieldCls} aria-label="Recent settled rounds">
                {!known && <option value="">{id ? `Round ${short(id, 4)}` : "Choose a round"}</option>}
                {recent.map((r) => <option key={r.id} value={r.id}>{r.lot ?? MODE_NAME[r.mode]} · {r.id.slice(0, 6)}</option>)}
              </select>
            </Field>
            <form onSubmit={(e) => { e.preventDefault(); void run(paste.trim() || id); }} className="mt-4 grid gap-2">
              <Field label="Or paste a round id">
                <input value={paste} onChange={(e) => setPaste(e.target.value.trim())} spellCheck={false} placeholder="64 characters" aria-invalid={a?.status === "bad"} className={cx(fieldCls, "text-[13.5px] tabular-nums")} />
              </Field>
              {a?.status === "bad" && <p className="text-[13px] text-bad">A round id is 64 letters and digits. Copy it from the round's page.</p>}
              <Btn type="submit" kind="secondary" disabled={a?.status === "checking"} testid="verify-run">{a?.status === "checking" ? "Checking…" : "Run the checks"}</Btn>
            </form>
          </Panel>

        <Panel className="self-start lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {!a ? <div className="py-10 text-center text-app-muted">Pick a round to check.</div> : (
            <>
              <div className="text-[13px] text-app-faint">Round {short(a.target, 6)}{d ? ` · ${d.lot ?? MODE_NAME[d.mode]} · ${MODE_NAME[d.mode]}` : ""}</div>
              {a.status === "checking" && <div className="py-10 text-center text-app-muted">Checking round {short(a.target, 6)}…</div>}
              {a.status === "missing" && <div className="py-8"><div className="text-[17px] font-medium">There's no round with that id</div><p className="mt-1 text-[14px] text-app-muted">Check the id, or pick a round from the list.</p></div>}
              {a.status === "unavailable" && <div className="py-8"><div className="text-[17px] font-medium">We couldn't check this round</div><p className="mt-1 text-[14px] text-app-muted">The service didn't answer, so there's no result for this attempt.</p><div className="mt-4"><Btn onClick={() => void run(a.target)}>Try again</Btn></div></div>}
              {a.status === "bad" && <div className="py-8 text-[14px] text-app-muted">Enter a valid round id to check it.</div>}
              {d && (
                <>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <div className="serif-figure text-[26px] leading-tight text-[#f3eee2]">{failed.length ? `${failed.length} check${failed.length > 1 ? "s" : ""} failed` : "All applicable checks pass"}</div>
                    <Pill kind={d.valid ? "good" : "bad"}>{d.valid ? "Record checks out" : "Does not verify"}</Pill>
                  </div>
                  <p className="mt-1 text-[13px] text-app-faint tabular-nums">{counted.filter((c) => c.ok).length} of {counted.length} applicable checks pass · {d.checks.length - counted.length} not applicable · record updated {when(d.updated)}</p>
                  <div className="mt-5 grid gap-5" data-testid="verify-results">
                    {failed.length > 0 && <Group title="Failed" checks={failed} />}
                    {GROUPS.map(([title, ids]) => by(ids).length > 0 && <Group key={title} title={title} checks={by(ids).filter((c) => !failed.includes(c))} />)}
                    {leftovers.length > 0 && <Group title="Other checks" checks={leftovers.filter((c) => !failed.includes(c))} />}
                  </div>
                  <div className="mt-6"><Btn href={`/auction/?id=${d.id}`} kind="secondary">Open the round</Btn></div>
                </>
              )}
            </>
          )}
        </Panel>
        <aside className="grid content-start gap-4 lg:col-start-1 lg:row-start-2">
          <Panel>
            <div className="text-[15px] font-medium">What this establishes</div>
            <ul className="mt-2 grid gap-2 text-[13.5px] text-app-muted">
              <li>That the published bids, result and accounting pass the checks below. They are reported by this service.</li>
              <li>Payments are attested by two of the three signers. These checks don't show that your wallet received funds; your wallet does.</li>
              <li>Bid prices become public after opening. Bidders' addresses and refund addresses are never published.</li>
            </ul>
          </Panel>
          {d && (
            <Panel>
              <div className="text-[15px] font-medium">Check it yourself</div>
              <p className="mt-1 text-[14px] text-app-muted">Download this round's public record and run Benzo's open-source verifier on your own computer.</p>
              <div className="mt-4 flex flex-wrap gap-2"><Btn href={`/api/auctions/${d.id}/public.tgz`} kind="secondary">Download the record</Btn></div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function Group({ title, checks }: { title: string; checks: Check[] }) {
  if (!checks.length) return null;
  return (
    <section>
      <h2 className="text-[18px] text-app-muted">{title}</h2>
      <ul className="mt-1">{checks.map((c) => (
        <li key={c.id} className="flex gap-3 border-t border-app-line py-2.5 text-[14.5px] first:border-t-0">
          {c.status === "not_applicable" ? <span className="mt-[3px] size-4 shrink-0 text-center text-app-faint">–</span> : <Tick ok={c.ok} />}
          <span className={cx("min-w-0 flex-1", c.status === "not_applicable" && "text-app-faint")}>{checkName(c.id)}{c.status === "not_applicable" ? " · not applicable to this round" : ""}
            {c.detail && (!c.ok || c.status === "warning") && <span className={cx("block text-[13px]", c.ok ? "text-warn" : "text-bad")}>{c.detail}</span>}</span>
        </li>
      ))}</ul>
    </section>
  );
}
