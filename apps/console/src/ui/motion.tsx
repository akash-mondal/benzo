/** Console motion vocabulary — one ease, calmer travel than the wallet. */
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export const EASE = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE, delay: (i as number) * 0.06 } }),
};
export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.28, ease: EASE }} className={className}>
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}
Stagger.Item = function Item({ children, index = 0, className = "" }: { children: ReactNode; index?: number; className?: string }) {
  return (
    <motion.div variants={fadeUp} custom={index} className={className}>
      {children}
    </motion.div>
  );
};

/**
 * ZK "proving" motion — the shared in-flight state for every prove/sign action.
 * A pulsing shield + a label that steps through the proof lifecycle so a ZK action
 * reads as "signing → proving → verifying on-chain", not a generic spinner.
 *
 * Honesty guard: the label is timer-driven (we don't get real per-phase events
 * here), so on a 3+-step lifecycle we deliberately HOLD on the penultimate step
 * ("Generating…"/"Proving…") and never let the timer reach the final
 * "Verifying … on-chain" label on its own. That last label only appears if the
 * caller advances to it — so the UI can't claim it's verifying on-chain while the
 * proof is in fact still being generated locally. (2-step flows advance fully:
 * their terminal step is the settle/verify action itself, not a separate claim.)
 */
export function Proving({ steps, className = "" }: { steps: string[]; className?: string }) {
  const [i, setI] = useState(0);
  // Cap the auto-advance one short of the final label when there are 3+ steps so
  // the timer can't reach a "Verifying on-chain" headline before it actually starts.
  const maxAuto = steps.length >= 3 ? steps.length - 2 : steps.length - 1;
  useEffect(() => {
    setI(0);
    const t = setInterval(() => setI((x) => (x + 1 <= maxAuto ? x + 1 : x)), 950);
    return () => clearInterval(t);
  }, [steps, maxAuto]);
  return (
    <div className={`flex items-center gap-2.5 rounded-lg border border-primary/25 bg-primary/[0.05] px-3.5 py-2.5 ${className}`} data-testid="zk-proving">
      <motion.span
        animate={{ scale: [1, 1.14, 1], opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        className="flex-none text-primary"
      >
        <ShieldCheck size={16} />
      </motion.span>
      <AnimatePresence mode="wait">
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="text-[12.5px] font-semibold text-primary"
        >
          {steps[Math.min(i, steps.length - 1)]}…
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/**
 * Result reveal — a spring scale/fade-in for a result card. `tone="danger"` adds a
 * single shake so a negative verdict is felt, not just colored.
 */
export function Reveal({ children, tone = "neutral", className = "", ...rest }: { children: ReactNode; tone?: "neutral" | "success" | "danger"; className?: string; [k: `data-${string}`]: string | undefined }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.985 }}
      animate={tone === "danger" ? { opacity: 1, y: 0, scale: 1, x: [0, -5, 5, -3, 3, 0] } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export { AnimatePresence, motion };
