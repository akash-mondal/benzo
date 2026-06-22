/**
 * Money display. The balance hero is the single focal point of Home: a big
 * Helvetica-Now figure that counts up on first paint, masks to dots when hidden,
 * and sizes cents smaller than dollars. AmountText is the inline form for rows.
 */
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { fmtUsd, splitAmount } from "../lib/format";

/** Smoothly count a number up to its target (skipped under reduced-motion). */
function useCountUp(target: number, durationMs = 900): number {
  const reduce = useReducedMotion();
  const [val, setVal] = useState(reduce ? target : 0);
  const raf = useRef(0);
  useEffect(() => {
    if (reduce) {
      setVal(target);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(from + (target - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, durationMs, reduce]);
  return val;
}

export function BalanceHero({
  stroops,
  hidden,
  loading,
}: {
  stroops: string | bigint;
  hidden: boolean;
  loading?: boolean;
}) {
  // Count up over the integer-dollar value; render the live string from it.
  const targetDollars = Number(BigInt(stroops || 0) / 10_000_000n);
  const animated = useCountUp(targetDollars);
  const { cents } = splitAmount(stroops);
  const liveStroops = BigInt(Math.round(animated)) * 10_000_000n;
  const { dollars } = splitAmount(liveStroops);

  if (loading) {
    return <div className="skeleton mt-1.5 h-[54px] w-48 rounded-2xl" aria-label="Loading balance" />;
  }
  if (hidden) {
    return (
      <div className="font-display text-hero mt-1.5 flex items-center gap-1 tracking-tight" aria-label="Balance hidden">
        {"••••••".split("").map((d, i) => (
          <span key={i} className="text-[40px] opacity-70">
            •
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="font-display tnum text-hero mt-1.5 flex items-baseline tracking-tight" aria-label={fmtUsd(stroops)}>
      <span className="text-hero-sub font-semibold">$</span>
      <span>{dollars.replace(/^\$/, "")}</span>
      <span className="text-hero-sub text-muted">.{cents}</span>
    </div>
  );
}

/** Inline amount for activity rows / sheets. `direction` colors + signs it. */
export function AmountText({
  stroops,
  direction,
  className = "",
}: {
  stroops: string | bigint;
  direction?: "in" | "out";
  className?: string;
}) {
  const s = fmtUsd(typeof stroops === "bigint" ? (stroops < 0n ? -stroops : stroops) : String(stroops).replace(/^-/, ""));
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  const color = direction === "in" ? "text-pos" : "text-ink";
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`font-display tnum ${color} ${className}`}
    >
      {sign}
      {s}
    </motion.span>
  );
}
