// How a round cleared, as a picture (after BoardUI's chart cards): every opened bid as a bar at its price, best first,
// winners in the doodles' sand-gold and the rest in sand, with the price the round set as a line across. Hovering a
// bar rolls the headline to that bid: its price and what happened to it. The rows come from the round's published
// result, already in the market's own words.
import { useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCountUp } from "@/hooks/use-count-up";

export type LadderRow = { key: string; label: string; price: number; won: boolean; faint?: boolean; word: string; name: string };
export type LadderLine = { value: number; label: string };

const k = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${n}`);

export default function BidLadder({ rows, line, title, sub }: { rows: LadderRow[]; line?: LadderLine; title: string; sub: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const r = hover !== null ? rows[hover] : null;
  const shown = useCountUp(r ? r.price : line?.value ?? Math.max(...rows.map((x) => x.price)));
  const top = Math.max(...rows.map((x) => x.price), line?.value ?? 0);
  if (!rows.length) return null;
  return (
    <section className="flex h-[320px] min-w-0 flex-col gap-4 rounded-[22px] bg-app-1 px-5 pb-3 pt-5 ring-1 ring-app-line backdrop-blur-xl sm:px-6" data-testid="ladder">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-app-muted">{r ? r.name : title}</p>
          <p key={hover ?? "line"} className="animate-number-fade mt-0.5 flex items-baseline gap-1.5">
            <span className="serif-figure text-[34px] leading-[1.05] text-[#f3eee2] tabular-nums">{shown.toLocaleString("en-US")}</span>
            <span className="text-[13px] text-app-muted">zats</span>
          </p>
          <p className="mt-0.5 text-[13px] text-app-faint">{r ? r.word : sub}</p>
        </div>
        <dl className="flex items-center gap-4 text-[12.5px] text-app-muted">
          <div className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-gold" aria-hidden /><dt>Won</dt></div>
          <div className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#ddd6c64d]" aria-hidden /><dt>Didn't win</dt></div>
          {line && <div className="flex items-center gap-1.5"><span className="h-0 w-3 border-t border-dashed border-gold" aria-hidden /><dt>{line.label}</dt></div>}
        </dl>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barCategoryGap={rows.length > 12 ? "18%" : "34%"}
            onMouseMove={(s) => { const i = Number(s?.activeTooltipIndex); if (s?.isTooltipActive && Number.isFinite(i)) setHover(i); }}
            onMouseLeave={() => setHover(null)}>
            <YAxis width={48} domain={[0, Math.ceil(top * 1.12)]} tickCount={4} tickFormatter={k} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#938e80" }} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} interval={rows.length > 14 ? "preserveStartEnd" : 0} tick={{ fontSize: 12.5, fill: "#938e80" }} />
            <Tooltip content={() => null} cursor={{ fill: "#ddd6c60f", radius: 6 }} />
            <Bar dataKey="price" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={550}>
              {rows.map((x, i) => <Cell key={x.key} fill={x.won ? "#e9cd84" : x.faint ? "#ddd6c626" : "#ddd6c64d"} fillOpacity={hover === null || hover === i ? 1 : 0.55} />)}
            </Bar>
            {line && <ReferenceLine y={line.value} stroke="#e9cd84" strokeDasharray="4 4" strokeOpacity={0.8} ifOverflow="extendDomain" />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
