/**
 * Console state: one provider that loads the session + all the read models the
 * screens render, and exposes a refresh after any write (approve, run payroll,
 * grant). Keeps the UI a thin, typed view over the BFF.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type {
  Account,
  ApprovalPolicy,
  AuthSession,
  Counterparty,
  DashboardSummary,
  Invoice,
  Member,
  PaymentOrder,
  PayrollBatch,
  TreasuryView,
  ViewingGrant,
} from "@benzo/types";
import { api, AUTH_CHANGED_EVENT, currentGoogleCredential } from "./api";

interface ConsoleState {
  session: AuthSession | null;
  dashboard: DashboardSummary | null;
  treasury: TreasuryView | null;
  payments: PaymentOrder[];
  payrolls: PayrollBatch[];
  invoices: Invoice[];
  grants: ViewingGrant[];
  counterparties: Counterparty[];
  accounts: Account[];
  members: Member[];
  policies: ApprovalPolicy[];
  loading: boolean;
  error: string | null;
  masked: boolean;
  toggleMasked: () => void;
  /** Reload all read models; resolves true when treasury + dashboard loaded. */
  refresh: () => Promise<boolean>;
}

const Ctx = createContext<ConsoleState | null>(null);

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [treasury, setTreasury] = useState<TreasuryView | null>(null);
  const [payments, setPayments] = useState<PaymentOrder[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollBatch[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [grants, setGrants] = useState<ViewingGrant[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [masked, setMasked] = useState<boolean>(() => localStorage.getItem("benzo.masked") === "1");
  const [authenticated, setAuthenticated] = useState(() => !!currentGoogleCredential());

  const toggleMasked = useCallback(() => {
    setMasked((m) => {
      const next = !m;
      localStorage.setItem("benzo.masked", next ? "1" : "0");
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    // Load every read model independently: a single transient failure (or one
    // slow endpoint) must NOT blank every screen at once - it used to, because
    // Promise.all rejects atomically. Each slice keeps its prior value on a
    // miss; we only surface an error if the whole load fails.
    const results = await Promise.allSettled([
      api.session(),
      api.dashboard(),
      api.treasury(),
      api.payments(),
      api.payrolls(),
      api.invoices(),
      api.grants(),
      api.counterparties(),
      api.accounts(),
      api.members(),
      api.policies(),
    ]);
    const [s, d, t, p, pr, inv, g, c, a, m, pol] = results;
    if (s.status === "fulfilled") setSession(s.value);
    if (d.status === "fulfilled") setDashboard(d.value);
    if (t.status === "fulfilled") setTreasury(t.value);
    if (p.status === "fulfilled") setPayments(p.value);
    if (pr.status === "fulfilled") setPayrolls(pr.value);
    if (inv.status === "fulfilled") setInvoices(inv.value);
    if (g.status === "fulfilled") setGrants(g.value);
    if (c.status === "fulfilled") setCounterparties(c.value);
    if (a.status === "fulfilled") setAccounts(a.value);
    if (m.status === "fulfilled") setMembers(m.value);
    if (pol.status === "fulfilled") setPolicies(pol.value);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    setError(failed.length === results.length ? (failed[0]?.reason as Error)?.message ?? "Failed to load" : null);
    setLoading(false);
    return t.status === "fulfilled" && d.status === "fulfilled"; // treasury + dashboard are critical
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    if (!authenticated) {
      setSession(null);
      setDashboard(null);
      setTreasury(null);
      setPayments([]);
      setPayrolls([]);
      setInvoices([]);
      setGrants([]);
      setCounterparties([]);
      setAccounts([]);
      setMembers([]);
      setPolicies([]);
      setError(null);
      setLoading(false);
      return () => {
        cancelled = true;
        if (retry) clearTimeout(retry);
      };
    }
    // First load; if the treasury/dashboard lost a race with a cold-starting
    // backend (the $0.00 bug), retry once so the dashboard isn't stuck empty.
    void refresh().then((ok) => {
      if (!ok && !cancelled) retry = setTimeout(() => void refresh(), 1500);
    });
    // Keep the live read models fresh while the console is open.
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) void refresh();
    }, 30_000);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      clearInterval(interval);
    };
  }, [authenticated, refresh]);

  useEffect(() => {
    const onAuthChanged = () => setAuthenticated(!!currentGoogleCredential());
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);

  return (
    <Ctx.Provider
      value={{ session, dashboard, treasury, payments, payrolls, invoices, grants, counterparties, accounts, members, policies, loading, error, masked, toggleMasked, refresh }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useConsole(): ConsoleState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConsole must be used within ConsoleProvider");
  return v;
}

/** Map a counterparty id to its display name (for masked tables). */
export function useCounterpartyName() {
  const { counterparties } = useConsole();
  return (id?: string) => counterparties.find((c) => c.id === id)?.name ?? "Unknown";
}
