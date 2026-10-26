// Depth, as on an exchange: the opened bids stacked from the best price outward, so you can see the price at which demand
// meets the units on offer. Buyers stack from the highest price down; where sellers compete (buybacks, quotes), asks
// stack from the lowest price up against the units wanted. A dashed line marks the units, another the price the round
// set. Hover a step to read it.
import { useState } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type DepthBid = { price: number; qty: number; won: boolean };
const k = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${n}`);

export default function Depth({ bids, units, price, sells }: { bids: DepthBid[]; units: number; price?: number; sells: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const sorted = [...bids].sort((a, b) => (sells ? a.price - b.price : b.price - a.price));
  let cum = 0;
  const pts = sorted.map((b) => ({ price: b.price, qty: (cum += b.qty), won: b.won }));
  if (!pts.length) return <div className="grid h-full place-items-center text-[13px] text-app-faint">No opened bids to stack.</div>;
  const h = hover !== null ? pts[hover] : null;
  return (
    <div className="relative h-full min-h-0" data-testid="depth">
      <div className="pointer-events-none absolute left-3 top-1 z-10 text-[12.5px] text-app-muted tabular-nums">
        {h ? <>{sells ? "Up to" : "At or above"} <span className="text-app-text">{h.price.toLocaleString("en-US")} zats</span>: {h.qty} unit{h.qty === 1 ? "" : "s"} {sells ? "offered" : "wanted"}</> : <>{sells ? "Asks" : "Bids"} stacked from the best price · {units} unit{units === 1 ? "" : "s"} {sells ? "wanted" : "on offer"}</>}
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={pts} margin={{ top: 26, right: 12, bottom: 0, left: 4 }}
          onMouseMove={(s) => { const i = Number(s?.activeTooltipIndex); if (s?.isTooltipActive && Number.isFinite(i)) setHover(i); }} onMouseLeave={() => setHover(null)}>
          <defs><linearGradient id="dep" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e9cd84" stopOpacity={0.35} /><stop offset="100%" stopColor="#e9cd84" stopOpacity={0.02} /></linearGradient></defs>
          <XAxis dataKey="price" type="number" domain={["dataMin", "dataMax"]} reversed={!sells} tickFormatter={k} tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 12, fill: "#938e80" }} />
          <YAxis width={36} allowDecimals={false} domain={[0, Math.max(units, cum) + 1]} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#938e80" }} />
          <Tooltip content={() => null} cursor={{ stroke: "#ddd6c633" }} />
          <Area type="stepAfter" dataKey="qty" stroke="#e9cd84" strokeWidth={1.5} fill="url(#dep)" isAnimationActive animationDuration={600} />
          <ReferenceLine y={units} stroke="#ddd6c666" strokeDasharray="4 4" label={{ value: `${units} on offer`, position: "insideTopLeft", fill: "#938e80", fontSize: 11 }} />
          {price !== undefined && <ReferenceLine x={price} stroke="#e9cd84" strokeDasharray="4 4" label={{ value: `${price.toLocaleString("en-US")}`, position: "top", fill: "#e9cd84", fontSize: 11 }} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
