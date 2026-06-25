/**
 * Benzo for Business is a desktop product (dense tables, maker-checker, treasury).
 * On small screens we don't cram it - we show a calm message and point phone users
 * to the consumer wallet, which is built for mobile.
 */
import { useEffect, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { Logo } from "../ui/Logo";

/** True when the viewport is at least desktop width. Reacts to resize/rotate. */
export function useIsDesktop(min = 1024): boolean {
  const [desktop, setDesktop] = useState(() => (typeof window === "undefined" ? true : window.innerWidth >= min));
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${min}px)`);
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [min]);
  return desktop;
}

export function DesktopOnly() {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[var(--color-canvas-outer)] px-6 text-center" data-testid="console-desktop-only">
      <div className="max-w-[380px]">
        <div className="mx-auto mb-6 flex items-center justify-center gap-2 text-ink">
          <Logo size={24} /> <span className="font-display text-lg">Benzo for Business</span>
        </div>
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Monitor size={26} />
        </div>
        <h1 className="font-display text-2xl">Open this on a computer</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          The business console runs on desktop. Payroll, approvals, and your treasury need the room. Head to a laptop to get set up.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-[12.5px] text-muted">
          <Smartphone size={14} className="text-primary" />
          On your phone? The Benzo wallet is built for it.
        </div>
      </div>
    </div>
  );
}
