// Rounds per day (after BoardUI's orders chart card): a bar for each day, the part that traded in the doodles' sand-
// gold over the part that didn't (no trade, refunded, cancelled, still running). The headline counts the rounds in the
// range and rolls to a day's own count while you hover it. Days are the reader's own calendar days, by when bidding
// closed.
import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { useCountUp } from "@/hooks/use-count-up";
import { traded } from "../../lib/outcome";
import type { AuctionSummary } from "../../lib/types";

type Day = { key: string; label: string; full: string; traded: number; other: number; running: number; paid: number };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function days(list: AuctionSummary[], span: number): Day[] {
  const out: Day[] = [], at = new Map<string, Day>(), today = new Date();
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const day = { key: dayKey(d), label: d.toLocaleDateString([], span > 7 ? { day: "numeric" } : { weekday: "short" }), full: d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }), traded: 0, other: 0, running: 0, paid: 0 };
    out.push(day); at.set(day.key, day);
  }
  for (const a of list) {
    const day = at.get(dayKey(new Date(a.T_submit * 1000)));
    if (!day) continue;
    // Settled and traded: paid out. Settled or cancelled without a trade: refunded. Anything else is still running.
    if (a.state === "SETTLED" && traded(a)) { day.traded++; day.paid += Number(a.outcome?.paid_zats ?? 0); }
    else if (a.state === "SETTLED" || a.state === "CANCELLED") day.other++;
    else day.running++;
  }
  return out;
}

export default function Activity({ list, className = "h-[340px]" }: { list: AuctionSummary[]; className?: string }) {
  const [span, setSpan] = useState(7);
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => days(list, span), [list, span]);
  const d = hover !== null ? data[hover] : null;
  const total = d ? d.traded + d.other + d.running : data.reduce((n, x) => n + x.traded + x.other + x.running, 0);
  const tradedN = d ? d.traded : data.reduce((n, x) => n + x.traded, 0);
  const paid = d ? d.paid : data.reduce((n, x) => n + x.paid, 0);
  const shown = useCountUp(total);
  const top = Math.max(1, ...data.map((x) => x.traded + x.other + x.running));
  const running = d ? d.running : data.reduce((n, x) => n + x.running, 0);

  return (
    <section className={`flex min-h-0 min-w-0 flex-col gap-4 rounded-[14px] bg-app-1 px-4 pb-3 pt-4 ring-1 ring-app-line backdrop-blur-xl ${className}`} data-testid="activity">
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[13px] text-app-muted">{d ? d.full : `Rounds in the last ${span} days`}</p>
          <SegmentedControl aria-label="Range" selectedKeys={new Set([String(span)])} onSelectionChange={(k) => { const v = [...k][0]; if (v) { setSpan(Number(v)); setHover(null); } }}>
            <SegmentedControlItem id="7">7d</SegmentedControlItem>
            <SegmentedControlItem id="30">30d</SegmentedControlItem>
          </SegmentedControl>
        </div>
        <p key={hover ?? "all"} className="animate-number-fade serif-figure text-[34px] leading-[1.05] text-[#f3eee2] tabular-nums">{shown.toLocaleString("en-US")}</p>
        <p className="text-[12.5px] text-app-faint tabular-nums">{tradedN} traded{paid ? ` · ${paid.toLocaleString("en-US")} zats paid out` : ""}{running ? ` · ${running} still running` : ""}</p>
        <dl className="mt-1 flex items-center gap-4 text-[12px] text-app-muted">
          <div className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-gold" aria-hidden /><dt>Traded</dt></div>
          <div className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#ddd6c64d]" aria-hidden /><dt>Refunded</dt></div>
          <div className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#ddd6c626]" aria-hidden /><dt>Running</dt></div>
        </dl>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barCategoryGap={span > 7 ? "22%" : "38%"}
            onMouseMove={(s) => { const i = Number(s?.activeTooltipIndex); if (s?.isTooltipActive && Number.isFinite(i)) setHover(i); }}
            onMouseLeave={() => setHover(null)}>
            <YAxis width={36} allowDecimals={false} domain={[0, Math.ceil(top * 1.15)]} tickCount={4} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#938e80" }} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} interval={span > 7 ? 3 : 0} tick={{ fontSize: 12.5, fill: "#938e80" }} />
            <Tooltip content={() => null} cursor={{ fill: "#ddd6c60f", radius: 6 }} />
            <Bar dataKey="traded" stackId="r" fill="#e9cd84" radius={[0, 0, 3, 3]} isAnimationActive animationDuration={500} />
            <Bar dataKey="other" stackId="r" fill="#ddd6c64d" isAnimationActive animationDuration={500} />
            <Bar dataKey="running" stackId="r" fill="#ddd6c626" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={500} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
