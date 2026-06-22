/**
 * Approvals — the dual-control release gate. Each payment awaiting approval shows
 * what it hides vs proves; Approve releases it and settles a real shielded
 * transfer on testnet (when a recipient @handle is attached). Calm tones; red is
 * for failure only.
 */
import { useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import type { PaymentOrder } from "@benzo/types";
import { api } from "../lib/api";
import { useConsole, useCounterpartyName } from "../lib/store";
import { fmtUsd, explorerTxUrl, friendlyError } from "../lib/format";
import { NETWORK_LABEL } from "../lib/network";
import { motion, AnimatePresence } from "framer-motion";
import { Page, EASE } from "../ui/motion";
import { Button, Card, EmptyState, Pill, PrivacyDisclosure, Skeleton, StatusPill, useToast } from "../ui/primitives";

export function Approvals() {
  const toast = useToast();
  const { payments, members, masked, refresh, loading } = useConsole();
  const name = useCounterpartyName();
  const [busy, setBusy] = useState<string | null>(null);
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const memberRole = (id: string) => members.find((m) => m.id === id)?.role ?? "";

  const pending = payments.filter((p) => p.status === "needs_approval");
  const decided = payments.filter((p) => p.status !== "needs_approval");

  async function decide(p: PaymentOrder, decision: "approved" | "denied") {
    setBusy(p.id + decision);
    try {
      // Each click records ONE approval against the next step (proposer ≠ approver,
      // enforced server-side). The run releases only when every step is satisfied.
      const updated = await api.approvePayment(p.id, { decision });
      const prog = updated.progress;
      if (decision === "denied") {
        toast({ title: "Payment denied", tone: "muted" });
      } else if (prog?.satisfied) {
        toast({ title: updated.settlement?.onChain ? "Released and paid" : "Released and paid (demo)", tone: "success" });
      } else {
        toast({ title: `Approved · now needs ${prog?.nextRole ?? "another approver"}${prog?.nextKind === "release" ? " to release" : ""}`, tone: "success" });
      }
      await refresh();
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page>
      <div className="mb-5">
        <h1 className="font-display text-2xl">Approvals</h1>
        <p className="mt-1 text-[13.5px] text-muted">Release gated payments. Each one settles a real shielded transfer on {NETWORK_LABEL}.</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Card key={i} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-16 w-72 max-w-full rounded-lg" />
                </div>
                <div className="flex flex-col items-end gap-3">
                  <Skeleton className="h-7 w-24" />
                  <Skeleton className="h-8 w-40" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : pending.length === 0 ? (
        <EmptyState title="All clear" hint="No payments are waiting on your approval." />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
          {pending.map((p, i) => (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 28, scale: 0.97 }}
              transition={{ duration: 0.32, ease: EASE, delay: i * 0.04 }}
            >
              <Card className="p-5" >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold">{p.memo ?? "Payment"}</div>
                    <div className="mt-0.5 text-[13px] text-muted">
                      To {name(p.toCounterpartyId)} · {p.type.replace(/_/g, " ")}
                    </div>
                    <div className="mt-3 max-w-md">
                      <PrivacyDisclosure hidden={["Amount", "Who you're paying"]} proven={["Approved recipient", "Funds verified clean"]} />
                    </div>
                    {/* maker-checker trail: who has approved so far */}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="approval-trail">
                      {(p.approvals ?? []).filter((a) => a.decision === "approved").length === 0 ? (
                        <span className="text-[12px] text-muted">No approvals yet · proposer can't self-approve</span>
                      ) : (
                        (p.approvals ?? [])
                          .filter((a) => a.decision === "approved")
                          .map((a) => (
                            <Pill key={a.id} tone="success">
                              <Check size={11} /> {memberName(a.approverMemberId)} · {memberRole(a.approverMemberId)}
                            </Pill>
                          ))
                      )}
                    </div>
                    {(p.approvals ?? []).filter((a) => a.decision === "approved").length > 0 ? (
                      <div className="mt-1.5 text-[11.5px] text-muted">
                        Your named operational record. A third party sees only the anonymous “approved N-of-M” proof — never who signed.
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-3">
                    <div className="font-display tnum text-2xl font-semibold text-fg" data-testid="approval-amount">
                      {masked || p.privacy.amountHidden ? "••••" : fmtUsd(p.amount.amount)}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" loading={busy === p.id + "denied"} onClick={() => decide(p, "denied")} data-testid="deny-btn">
                        <X size={15} /> Deny
                      </Button>
                      <Button loading={busy === p.id + "approved"} onClick={() => decide(p, "approved")} data-testid="approve-btn">
                        <Check size={15} /> Approve & release
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
          </AnimatePresence>
        </div>
      )}

      {decided.length > 0 ? (
        <>
          <div className="mb-2 mt-7 text-[12px] font-bold uppercase tracking-[0.05em] text-muted">Recently decided</div>
          <Card className="divide-y divide-border p-0">
            {decided.slice(0, 6).map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-5 py-3 text-[13.5px]">
                <span className="flex-1 truncate">{p.memo ?? "Payment"} · {name(p.toCounterpartyId)}</span>
                <StatusPill status={p.status} />
                {p.settlement?.txHash ? (
                  <a href={explorerTxUrl(p.settlement.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                    Receipt <ExternalLink size={12} />
                  </a>
                ) : null}
                <span className="font-display tnum w-20 text-right font-semibold text-fg">{masked || p.privacy.amountHidden ? "••••" : fmtUsd(p.amount.amount)}</span>
              </div>
            ))}
          </Card>
        </>
      ) : null}
    </Page>
  );
}
