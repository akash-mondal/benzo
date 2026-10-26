// A row of headline figures (BoardUI's stat cards, in the sky's look): a small label, the figure in the serif that
// rolls up from zero when the page opens, an optional unit and a one-line note. Every figure is computed from the
// published rounds; nothing here is a target or a guess.
import { useEffect, useState } from "react";
import { cx } from "../app/ui";

export type StatItem = { label: string; value: number; unit?: string; note?: string; gold?: boolean; testid?: string };

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

// The figure as shown: the server renders the true value; once the page is live it rolls up from zero to it, and
// rolls between values when the data refreshes.
function useRoll(value: number, ms = 900) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    let raf = 0;
    const from = shown === value ? 0 : shown, start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(Math.round(from + (value - from) * ease(t)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

function Stat({ label, value, unit, note, gold, testid }: StatItem) {
  const n = useRoll(value);
  return (
    <div className="min-w-0 rounded-[20px] bg-app-1 p-5 ring-1 ring-app-line backdrop-blur-xl" data-testid={testid} data-value={value}>
      <div className="text-[12.5px] text-app-faint">{label}</div>
      <div className="mt-1.5 flex min-w-0 items-baseline gap-1.5">
        <span className={cx("serif-figure truncate pb-0.5 text-[32px] leading-[1.05] tabular-nums", gold ? "chrome" : "text-[#f3eee2]")}>{n.toLocaleString("en-US")}</span>
        {unit && <span className="shrink-0 text-[13px] text-app-muted">{unit}</span>}
      </div>
      {note && <div className="mt-1 truncate text-[13px] text-app-muted">{note}</div>}
    </div>
  );
}

export default function Stats({ items, className }: { items: StatItem[]; className?: string }) {
  return <div className={cx("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{items.map((i) => <Stat key={i.label} {...i} />)}</div>;
}
