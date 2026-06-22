/**
 * ⌘K command bar — was a dead affordance (a styled div). Now a real, minimal
 * jump-to palette: open with ⌘K or a click, type to filter, Enter or click to
 * navigate. Keeps the topbar's search affordance honest.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const DESTINATIONS = [
  { label: "Dashboard", to: "/" },
  { label: "Contractors", to: "/contractors" },
  { label: "Payroll", to: "/payroll" },
  { label: "Invoices to pay", to: "/invoices" },
  { label: "Send & vendor pay", to: "/pay" },
  { label: "Invites", to: "/invites" },
  { label: "Approvals", to: "/approvals" },
  { label: "Treasury", to: "/treasury" },
  { label: "Auditor grants", to: "/grants" },
  { label: "Audit log", to: "/audit" },
  { label: "Settings & team", to: "/settings" },
];

export function CommandBar() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matches = useMemo(
    () => DESTINATIONS.filter((d) => d.label.toLowerCase().includes(q.trim().toLowerCase())),
    [q],
  );

  function go(to: string) {
    setOpen(false);
    setQ("");
    nav(to);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-[34px] w-[300px] flex-none items-center gap-2 whitespace-nowrap rounded-[9px] border border-border bg-bg px-3 text-[13px] text-[#9a9ea3] outline-none transition hover:border-[#cfd2cc] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
        data-testid="command-open"
      >
        <Search size={15} className="flex-none" />
        <span className="truncate">Search payees, runs, actions…</span>
        <span className="ml-auto flex-none rounded border border-border bg-surface px-1.5 text-[11px]">⌘K</span>
      </button>

      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
            <motion.div
              className="absolute inset-0 bg-fg/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.18 }}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (matches[0]) go(matches[0].to);
                }}
                className="flex items-center gap-2 border-b border-border px-4 py-3"
              >
                <Search size={16} className="text-muted" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Jump to a screen…"
                  className="w-full bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
                  data-testid="command-input"
                />
              </form>
              <div className="max-h-[300px] overflow-y-auto py-1">
                {matches.length === 0 ? (
                  <div className="px-4 py-3 text-[13px] text-muted">No matches.</div>
                ) : (
                  matches.map((d) => (
                    <button
                      key={d.to}
                      onClick={() => go(d.to)}
                      className="flex w-full items-center px-4 py-2.5 text-left text-[13.5px] text-fg outline-none transition hover:bg-[#f4f3ef] focus-visible:bg-[#f4f3ef]"
                    >
                      {d.label}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
