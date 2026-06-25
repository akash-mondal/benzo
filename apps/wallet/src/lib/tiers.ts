/**
 * Verification tiers (C5 - Cash App parity, privacy-adapted). The "tier" is the
 * ZK ASSURANCE LEVEL (proven by the kyc_credential circuit), NOT a record of
 * identity - no SSN/name/DOB ever lives in this app. We surface the *capability*
 * a tier unlocks (a higher private SEND ramp) and gate large sends just-in-time.
 *
 * Privacy rules baked in: receiving is ALWAYS unlimited + anonymous (no receive
 * cap, unlike Cash App), there is NO "total account" ceiling (that would require
 * observing total flows and defeat the shield), and the badge shows the level,
 * never the documents. The real tier bump happens at the fiat/IDV edge (provider);
 * here we display the tier the session reports and route accordingly.
 */
export const TIERS = {
  0: { label: "Anonymous", sendCap: 100, cta: "Verify you're human to raise limits" },
  1: { label: "Verified human", sendCap: 1_000, cta: "Verify your ID to raise limits" },
  2: { label: "ID verified", sendCap: 40_000, cta: null },
  3: { label: "Full", sendCap: 250_000, cta: null },
} as const;

export type TierNum = 0 | 1 | 2 | 3;

export function tierOf(n: number | undefined): TierNum {
  const t = Math.max(0, Math.min(3, Math.floor(n ?? 1)));
  return t as TierNum;
}

export function tierInfo(n: number | undefined) {
  return TIERS[tierOf(n)];
}

/** The cap (USD) on a single private send at this tier. Receiving is always unlimited. */
export function sendCapUsd(n: number | undefined): number {
  return TIERS[tierOf(n)].sendCap;
}

/** Does `amount` (USD) require a higher tier than the user currently has? */
export function needsStepUp(amountUsd: number, currentTier: number | undefined): boolean {
  if (!(amountUsd > 0)) return false;
  return amountUsd > sendCapUsd(currentTier) && tierOf(currentTier) < 3;
}

/** The tier that WOULD clear `amount` (the next step the user should take). */
export function tierForAmount(amountUsd: number): TierNum {
  for (const t of [0, 1, 2, 3] as TierNum[]) {
    if (amountUsd <= TIERS[t].sendCap) return t;
  }
  return 3;
}

/** Honest, abstracted step-up copy. The ID never goes on-chain. */
export function stepUpMessage(amountUsd: number, currentTier: number | undefined): string {
  const need = TIERS[tierForAmount(amountUsd)];
  return `Sends over ${usd(sendCapUsd(currentTier))} need a quick one-time ID check to unlock up to ${usd(need.sendCap)}. Your ID never goes on-chain, and the network only learns that you cleared the tier.`;
}

function usd(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toLocaleString()}k` : `$${n.toLocaleString()}`;
}
