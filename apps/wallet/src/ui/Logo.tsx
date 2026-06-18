/**
 * The Benzo geometric mark. One path, currentColor by default so it inherits ink
 * or accent from context. `animated` traces a soft draw-in for the splash/onboard.
 */
import { motion } from "framer-motion";

const PATH =
  "M 64 128 L 64.5 128 L 32 95 L 0 64 L 0 0 L 64 0 L 128 64 L 128 64.5 L 161 32 L 192 0 L 256 0 L 256 64 L 192 128 L 128 128 L 128 192 L 96 223 L 63.5 256 L 0 256 L 0 192 Z M 256 192 L 224 223 L 191.5 256 L 128 256 L 128 192 L 192 128 L 256 128 Z";

export function Logo({ size = 28, className = "", title = "Benzo" }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      role="img"
      aria-label={title}
      className={className}
    >
      <path d={PATH} />
    </svg>
  );
}

/** Splash variant — the mark draws/settles in with a spring scale. */
export function LogoMark({ size = 64, className = "" }: { size?: number; className?: string }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-label="Benzo"
      className={className}
      initial={{ opacity: 0, scale: 0.6, rotate: -8 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 18 }}
    >
      <path d={PATH} />
    </motion.svg>
  );
}
