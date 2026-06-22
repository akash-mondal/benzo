/**
 * Approval policies (B4 — Ramp parity). Author M-of-N approval chains: routing
 * CONDITIONS (amount/counterparty — evaluated privately by the BFF over the
 * plaintext proposal, since Benzo hides those on-chain), ordered APPROVE STEPS,
 * and a separate RELEASE GATE (sign & settle). This is NOT cosmetic: the release
 * gate's threshold maps onto GENUINELY-ENFORCED dual-control — org_account
 * threshold + the in-circuit joinsplit_org M-of-N (JSPLITORG, verified on testnet).
 */
import { useState } from "react";
import { ShieldCheck, Lock, Plus, Minus, Save } from "lucide-react";
import type { ApprovalPolicy, ApprovalStep } from "@benzo/types";
import { api } from "../lib/api";
import { useConsole } from "../lib/store";
import { friendlyError } from "../lib/format";
import { policySummary, conditionLabel, totalApprovers } from "../lib/policy";
import { Page, Stagger, motion, AnimatePresence, EASE } from "../ui/motion";
import { Button, Card, Pill, useToast } from "../ui/primitives";

export function Policies() {
  const { policies, refresh, loading } = useConsole();

  return (
    <Page>
      <div className="mb-5">
        <h1 className="font-display text-2xl">Approval policies</h1>
        <p className="mt-1 text-[13.5px] text-muted">Who must approve, and who signs to release. The release gate is enforced on-chain by the dual-control circuit.</p>
      </div>

      {loading && policies.length === 0 ? null : policies.length === 0 ? (
        <Card className="p-10 text-center text-[14px] text-muted">No policies yet.</Card>
      ) : (
        <Stagger className="space-y-4">
          {policies.map((p, i) => (
            <Stagger.Item key={p.id} index={i}>
              <PolicyEditor policy={p} onSaved={refresh} />
            </Stagger.Item>
          ))}
        </Stagger>
      )}
    </Page>
  );
}

function PolicyEditor({ policy, onSaved }: { policy: ApprovalPolicy; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const [steps, setSteps] = useState<ApprovalStep[]>(() => policy.steps.map((s) => ({ ...s })));
  const [gate, setGate] = useState<ApprovalStep | undefined>(() => (policy.releaseGate ? { ...policy.releaseGate } : undefined));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify({ steps, gate }) !== JSON.stringify({ steps: policy.steps, gate: policy.releaseGate });
  const draft = { ...policy, steps, releaseGate: gate };

  function bumpStep(idx: number, delta: number) {
    setSteps((ss) => ss.map((s, i) => (i === idx ? { ...s, minApprovers: Math.max(1, s.minApprovers + delta) } : s)));
  }
  function toggleMode(idx: number) {
    setSteps((ss) => ss.map((s, i) => (i === idx ? { ...s, mode: s.mode === "all" ? "any" : "all" } : s)));
  }
  function bumpGate(delta: number) {
    setGate((g) => (g ? { ...g, minApprovers: Math.max(1, g.minApprovers + delta) } : g));
  }

  async function save() {
    setBusy(true);
    try {
      await api.updatePolicy(policy.id, { steps, releaseGate: gate });
      await onSaved();
      toast({ title: "Policy saved", tone: "success" });
    } catch (e) {
      toast({ title: friendlyError(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-0" data-testid="policy-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="text-[14px] font-semibold">{policy.name}</div>
        <Pill tone="muted">{totalApprovers(draft)} approvals</Pill>
      </div>
      <div className="px-5 py-4 text-[13px] text-muted" data-testid="policy-summary">{policySummary(draft)}</div>

      {/* Routing — evaluated privately by the BFF (Benzo hides amount/counterparty on-chain). */}
      <Section label="Routing · evaluated privately by Benzo">
        {policy.conditions.length === 0 ? (
          <div className="text-[13px] text-muted">Applies to every payment.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {policy.conditions.map((c, i) => (
              <Pill key={i} tone="primary">{conditionLabel(c)}</Pill>
            ))}
          </div>
        )}
      </Section>

      {/* Approve steps — the maker-checker chain. */}
      <Section label="Approval steps">
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg bg-canvas px-3.5 py-2.5" data-testid="policy-step">
              <span className="flex-1 text-[13.5px] capitalize">{s.role}</span>
              <motion.button whileTap={{ scale: 0.9 }} onClick={() => toggleMode(i)} className="rounded-full border border-border px-2.5 py-1 text-[12px] font-semibold" data-testid="policy-step-mode">
                {s.mode === "all" ? "Require all" : "Require any"}
              </motion.button>
              <Stepper value={s.minApprovers} onDec={() => bumpStep(i, -1)} onInc={() => bumpStep(i, 1)} testid="policy-step-min" />
            </div>
          ))}
        </div>
      </Section>

      {/* Release gate — the part enforced on-chain. */}
      {gate ? (
        <Section label="Sign & release (on-chain)">
          <div className="flex items-center gap-3 rounded-lg bg-canvas px-3.5 py-2.5">
            <Lock size={15} className="text-primary" />
            <span className="flex-1 text-[13.5px] capitalize">{gate.role}</span>
            <Stepper value={gate.minApprovers} onDec={() => bumpGate(-1)} onInc={() => bumpGate(1)} testid="policy-gate-min" />
          </div>
        </Section>
      ) : null}

      {/* The differentiator: this is genuinely enforced, not just a server policy. */}
      <div className="mx-5 mb-4 flex items-start gap-2 rounded-xl bg-primary/[0.06] px-3.5 py-3 text-[12.5px] text-fg" data-testid="policy-enforcement">
        <ShieldCheck size={15} className="mt-0.5 flex-none text-primary" />
        <span>
          <b>Enforced on-chain.</b> Org funds live in notes bound to your member set + threshold, and the pool's <code>transfer_org</code> entry only settles a spend that carries a valid in-circuit M-of-N proof (<code>JSPLITORG</code>) — the verifier rejects a single-key spend of org funds. So release is gated by the proof inside the contract, not by this server. <span className="text-muted">Separation of duties is always on: a proposer can never approve their own payment.</span>
        </span>
      </div>

      <div className="flex justify-end border-t border-border px-5 py-3">
        <Button onClick={save} loading={busy} disabled={!dirty} data-testid="policy-save"><Save size={14} /> Save policy</Button>
      </div>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border px-5 py-4">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.05em] text-muted">{label}</div>
      {children}
    </div>
  );
}

function Stepper({ value, onDec, onInc, testid }: { value: number; onDec: () => void; onInc: () => void; testid: string }) {
  return (
    <div className="flex items-center gap-2" data-testid={testid}>
      <motion.button whileTap={{ scale: 0.9 }} onClick={onDec} className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted transition hover:bg-canvas"><Minus size={14} /></motion.button>
      <span className="relative flex h-[18px] w-5 items-center justify-center overflow-hidden text-[14px] font-semibold tabular-nums">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -6, opacity: 0 }} transition={{ duration: 0.18, ease: EASE }} className="absolute">{value}</motion.span>
        </AnimatePresence>
      </span>
      <motion.button whileTap={{ scale: 0.9 }} onClick={onInc} className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted transition hover:bg-canvas"><Plus size={14} /></motion.button>
    </div>
  );
}
