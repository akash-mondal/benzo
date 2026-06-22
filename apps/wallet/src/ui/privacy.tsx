/**
 * The privacy chrome — the ONLY crypto vocabulary allowed on screen. Three pieces,
 * and not one of them is a toggle that turns privacy off:
 *   • PrivateChip   — ambient "only you can see this" (privacy is the default state)
 *   • ProvableChip  — appears only when a real ZK attestation backs the claim
 *   • HideToggle    — masks the *display* of a balance, never the protection
 * No seed phrases, gas, tx hashes, "connect wallet", or proof spinners.
 */
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

export function PrivateChip({ label = "Private · only you can see this" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-[#4a2fa0]">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      {label}
    </span>
  );
}

/** Shown ONLY when a real Groth16 attestation backs the figure (proof of balance/funds). */
export function ProvableChip({ label = "Provable" }: { label?: string }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="inline-flex items-center gap-1 rounded-full bg-pos/12 px-2.5 py-1 text-xs font-semibold text-pos"
    >
      <ShieldCheck size={12} /> {label}
    </motion.span>
  );
}

/**
 * Quiet, abstracted reassurance that a REAL proof backed a settled action. The
 * everyday-screen counterpart to ProvableChip: no crypto nouns (no "Groth16",
 * "zk-SNARK", "nullifier"), just the honest promise. Render ONLY when the proof
 * actually happened on-chain (callers gate on the real `onChain`/settled signal).
 */
export function ProofNote({ label = "Proof verified · no one saw your balance" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-pos" data-testid="proof-note">
      <ShieldCheck size={13} /> {label}
    </span>
  );
}

/** Eye toggle that masks the balance *display* (does not change protection). */
export function HideToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={hidden}
      aria-label={hidden ? "Show balance" : "Hide balance"}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/[0.06] text-ink transition outline-none hover:bg-ink/10 active:scale-90 focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
}
