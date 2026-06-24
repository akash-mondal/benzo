/**
 * Consumer wallet primitives — pill buttons, cards, bottom sheets, fields, the
 * segmented (Alchemy-Pay-style) tabbed control, avatars, toasts, and the success
 * checkmark. Warm + tactile: everything has a hover/active state, the focal
 * action carries the purple glow. Built on react + framer-motion + lucide.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";

/** Button props minus the handlers framer-motion redefines (drag / animation). */
type MotionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd"
>;
import { Check, Loader2, X } from "lucide-react";
import { initials } from "../lib/format";
import { spring } from "./motion";

// ----------------------------------------------------------------- buttons

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-accent text-white shadow-[var(--shadow-glow)] hover:brightness-110",
  secondary: "bg-card text-ink shadow-[0_6px_18px_rgba(25,40,55,0.05)] hover:shadow-[0_8px_22px_rgba(25,40,55,0.09)]",
  ghost: "bg-transparent text-ink hover:bg-ink/[0.05]",
  danger: "bg-danger text-white hover:brightness-110",
};

export function Button({
  children,
  variant = "primary",
  loading,
  full,
  size = "md",
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: BtnVariant;
  loading?: boolean;
  full?: boolean;
  size?: "sm" | "md" | "lg";
} & MotionButtonProps) {
  const sizes = { sm: "px-3.5 py-2 text-sm", md: "px-5 py-3 text-[15px]", lg: "px-6 py-4 text-base" };
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={spring}
      disabled={loading || rest.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50 ${BTN[variant]} ${sizes[size]} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : null}
      {children}
    </motion.button>
  );
}

/** Circular icon button (topbar eye/bell, sheet close). */
export function IconButton({
  children,
  badge,
  className = "",
  ...rest
}: { children: ReactNode; badge?: boolean } & MotionButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      className={`relative flex h-9 w-9 items-center justify-center rounded-full bg-ink/[0.06] text-ink transition outline-none hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40 ${className}`}
      {...rest}
    >
      {children}
      {badge ? <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-accent ring-2 ring-canvas" /> : null}
    </motion.button>
  );
}

// ----------------------------------------------------------------- surfaces

export function Card({
  children,
  className = "",
  onClick,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      onClick={onClick}
      className={`rounded-[var(--radius-card)] bg-card shadow-[var(--shadow-card)] ${onClick ? "cursor-pointer" : ""} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Avatar({ name, tone, size = 42 }: { name: string; tone?: "accent" | "amber" | "neutral"; size?: number }) {
  const tones = {
    accent: "bg-[#e7e0fb] text-[#4a2fa0]",
    amber: "bg-[#fbf1dd] text-[#9a6b12]",
    neutral: "bg-canvas text-ink",
  };
  return (
    <div
      className={`flex flex-none items-center justify-center rounded-full font-bold ${tones[tone ?? "neutral"]}`}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials(name)}
    </div>
  );
}

// ----------------------------------------------------------------- bottom sheet

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open ? (
        <div className="absolute inset-0 z-50 flex items-end justify-center">
          <motion.div
            className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative max-h-[88%] w-full overflow-y-auto rounded-t-[28px] bg-card px-5 pb-7 pt-3 no-scrollbar"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={spring}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ink/15" />
            {title ? (
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-xl">{title}</h2>
                <IconButton onClick={onClose} aria-label="Close">
                  <X size={18} />
                </IconButton>
              </div>
            ) : null}
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

// ----------------------------------------------------------------- fields

const fieldCls =
  "w-full rounded-2xl border border-hair bg-canvas/60 px-4 py-3 text-[15px] text-ink placeholder:text-muted " +
  "outline-none transition focus:border-accent focus:bg-card focus:ring-4 focus:ring-accent/15";

export function Input({
  label,
  hint,
  error,
  className = "",
  ...rest
}: { label?: string; hint?: ReactNode; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
      ) : null}
      <input id={id} className={`${fieldCls} ${error ? "border-danger ring-danger/15" : ""} ${className}`} {...rest} />
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

/** The big numeric amount entry used by Send / Request / Cash-out. */
export function AmountField({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-1 py-2">
      <span className="font-display text-4xl text-muted">$</span>
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, "");
          if ((v.match(/\./g) ?? []).length <= 1) onChange(v);
        }}
        placeholder="0"
        aria-label="Amount"
        className="font-display tnum w-full max-w-[260px] bg-transparent text-center text-5xl text-ink outline-none placeholder:text-ink/25"
      />
    </div>
  );
}

// --------------------------------------------------- segmented (Alchemy-Pay) tabs

export function Segmented<T extends string>({
  items,
  active,
  onChange,
}: {
  items: Array<{ id: T; label: ReactNode }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="relative flex rounded-full bg-ink/[0.05] p-1">
      {items.map((it) => {
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={`relative z-10 flex-1 rounded-full py-2 text-sm font-semibold transition outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? "text-white" : "text-muted hover:text-ink"}`}
          >
            {on ? (
              <motion.span
                layoutId="segmented-pill"
                className="absolute inset-0 -z-10 rounded-full bg-accent shadow-[var(--shadow-glow)]"
                transition={spring}
              />
            ) : null}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------- feedback

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} />;
}

/** Animated success checkmark for settled sends / cash-outs. */
export function SuccessCheck({ size = 72 }: { size?: number }) {
  return (
    <motion.div
      className="flex items-center justify-center rounded-full bg-pos/12 text-pos"
      style={{ width: size, height: size }}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={spring}
    >
      <motion.svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <motion.path
          d="M20 6 9 17l-5-5"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, ease: "easeOut", delay: 0.15 }}
        />
      </motion.svg>
    </motion.div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-muted">{icon}</div> : null}
      <div className="font-semibold text-ink">{title}</div>
      {hint ? <div className="max-w-[240px] text-sm text-muted">{hint}</div> : null}
    </div>
  );
}

// ----------------------------------------------------------------- toast

type Toast = { id: number; title: ReactNode; tone?: "success" | "danger" | "muted" };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export function useToast() {
  return useContext(ToastCtx);
}

let toastSeq = 0;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastSeq;
    setToasts((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 3600);
  }, []);
  const tone = {
    success: "text-pos",
    danger: "text-danger",
    muted: "text-ink",
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={spring}
              className={`pointer-events-auto flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-medium shadow-[var(--shadow-card)] ${tone[t.tone ?? "muted"]}`}
            >
              {t.tone === "success" ? <Check size={15} /> : null}
              {t.title}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
