/**
 * On-chain proof detail — the "see what happened on the blockchain" drill-down.
 * Every ZK proof / settlement result can attach an `OnChainRef`; this renders a
 * compact "View on-chain" link that opens a modal showing the verification key id,
 * the verified verdict, the public inputs, and clickable links to the verifier
 * CONTRACT (explorerContractUrl) and the settlement/verification TX (explorerTxUrl)
 * on stellar.expert — so a viewer can independently confirm the claim.
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, ShieldCheck, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { explorerContractUrl, explorerTxUrl, formatAddress } from "../lib/format";

/** Normalized on-chain reference any prove/settle result can carry. */
export interface OnChainRef {
  /** human title, e.g. "Payroll funded" */
  label?: string;
  /** verification key id on the verifier contract, e.g. "ORGBAL" */
  vkId?: string;
  /** did verify_proof return true on-chain */
  verified?: boolean;
  /** the verifier contract id (C…) */
  verifier?: string;
  /** "testnet" | "public" */
  network?: string;
  /** a settlement or verification tx hash, if any */
  txHash?: string;
  /** the Merkle root the proof folded to */
  root?: string;
  /** named public inputs disclosed by the proof */
  publics?: Array<{ k: string; v: string }>;
  /** TEE attestation compose-hash, when proven in the enclave */
  composeHash?: string;
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="flex-none text-[12.5px] text-muted">{k}</span>
      <span className={`text-right text-[12.5px] text-fg ${mono ? "break-all font-mono text-[11.5px]" : ""}`}>{v}</span>
    </div>
  );
}

/** Inline "View on-chain ↗" trigger + the detail modal. */
export function OnChainDetail({ refData, label = "View on-chain" }: { refData: OnChainRef; label?: string }) {
  const [open, setOpen] = useState(false);
  const net = refData.network && refData.network.toLowerCase().includes("public") ? "public" : "testnet";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary transition hover:underline"
        data-testid="view-onchain"
      >
        {label} <ArrowUpRight size={12} />
      </button>
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div className="absolute inset-0 bg-fg/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.div
              role="dialog"
              aria-modal="true"
              className="relative w-full max-w-md overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-xl"
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              data-testid="onchain-modal"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <ShieldCheck size={15} className="text-primary" /> {refData.label ?? "On-chain proof"}
                </div>
                <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-muted hover:bg-border/50" aria-label="Close"><X size={16} /></button>
              </div>
              <div className="px-5 py-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${refData.verified ? "bg-success/12 text-[#1d7a52]" : "bg-warning/15 text-[#9a6b12]"}`}>
                    <ShieldCheck size={12} /> {refData.verified ? "Verified on-chain" : "Generated (not yet on-chain)"}
                  </span>
                  {refData.vkId ? <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">vk · {refData.vkId}</span> : null}
                </div>
                <div className="divide-y divide-border">
                  {refData.network ? <Row k="Network" v={`Stellar ${net}`} /> : null}
                  {(refData.publics ?? []).map((p) => <Row key={p.k} k={p.k} v={p.v} />)}
                  {refData.root ? <Row k="Merkle root" v={formatAddress(refData.root, 8, 6)} mono /> : null}
                  {refData.composeHash ? <Row k="TEE compose-hash" v={formatAddress(refData.composeHash, 8, 6)} mono /> : null}
                  {refData.verified && refData.verifier ? (
                    <Row k="Verifier contract" v={<a className="inline-flex items-center gap-1 text-primary hover:underline" href={explorerContractUrl(refData.verifier, net)} target="_blank" rel="noreferrer">{formatAddress(refData.verifier, 6, 4)} <ArrowUpRight size={11} /></a>} />
                  ) : null}
                  {refData.verified && refData.txHash ? (
                    <Row k="Transaction" v={<a className="inline-flex items-center gap-1 text-primary hover:underline" href={explorerTxUrl(refData.txHash, net)} target="_blank" rel="noreferrer">{formatAddress(refData.txHash, 6, 4)} <ArrowUpRight size={11} /></a>} />
                  ) : null}
                </div>
                <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                  {refData.verified ? (
                    <>This claim is a real Groth16 proof checked by the on-chain verifier. Anyone can re-run <span className="font-mono">verify_proof</span> against the contract above — no trust in Benzo required.</>
                  ) : (
                    <>This proof was generated but is <span className="font-semibold text-fg">not yet verified on-chain</span>. Connect to a live network to settle and re-verify it against the contract.</>
                  )}
                </p>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
