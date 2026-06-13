/**
 * SEP-24 anchor presets the existing @benzo/anchor AnchorClient can drive.
 *
 * The corridor's off-ramp (cash-out) is just "unshield to a public address,
 * then hand that USDC to a SEP-24 anchor that pays out fiat." Because that flow
 * is pure SEP-1/10/24, swapping the self-hosted testnet anchor for a real one
 * is a config change — no protocol change. These presets capture the home
 * domain + asset for each corridor. The external ones require the provider's
 * onboarding/allowlisting to actually transact; the shape is ready.
 */

export interface AnchorPreset {
  key: string;
  label: string;
  /** SEP-1 home domain that serves /.well-known/stellar.toml */
  homeDomain: string;
  assetCode: string;
  /** issuer for the asset, or undefined to read it from the anchor's TOML */
  assetIssuer?: string;
  network: "testnet" | "public";
  /** true when live transactions need the provider to allowlist the account */
  requiresOnboarding: boolean;
  notes?: string;
}

/** Self-hosted Benzo anchor (this repo) — the key-free testnet default. */
export const BENZO_SELF_HOSTED: AnchorPreset = {
  key: "benzo",
  label: "Benzo self-hosted anchor",
  homeDomain: process.env.ANCHOR_HOME_DOMAIN ?? "localhost:8888",
  assetCode: "USDC",
  assetIssuer: process.env.USDC_ISSUER,
  network: "testnet",
  requiresOnboarding: false,
  notes: "Real on-chain USDC settlement at the edges; fiat leg simulated (BENZO.md §8.2).",
};

/** MoneyGram Access — global cash in/out over SEP-24 USDC on Stellar. */
export const MONEYGRAM: AnchorPreset = {
  key: "moneygram",
  label: "MoneyGram Access",
  homeDomain: "stellar.moneygram.com",
  assetCode: "USDC",
  assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  network: "public",
  requiresOnboarding: true,
  notes: "Cash pickup/drop at MoneyGram retail. Testnet: stellar.moneygram.com has a sandbox; production needs partner onboarding.",
};

/** Alfred — LatAm fiat off-ramp (SEP-24). */
export const ALFRED: AnchorPreset = {
  key: "alfred",
  label: "Alfred (LatAm off-ramp)",
  homeDomain: "alfredpay.io",
  assetCode: "USDC",
  network: "public",
  requiresOnboarding: true,
  notes: "Bank/cash payout across LatAm corridors. Asset issuer read from the anchor TOML.",
};

export const ANCHOR_PRESETS: Record<string, AnchorPreset> = {
  [BENZO_SELF_HOSTED.key]: BENZO_SELF_HOSTED,
  [MONEYGRAM.key]: MONEYGRAM,
  [ALFRED.key]: ALFRED,
};

/** Look up a preset by key, defaulting to the self-hosted testnet anchor. */
export function anchorPreset(key = process.env.ANCHOR_PRESET ?? "benzo"): AnchorPreset {
  const p = ANCHOR_PRESETS[key];
  if (!p) throw new Error(`unknown anchor preset: ${key} (have: ${Object.keys(ANCHOR_PRESETS).join(", ")})`);
  return p;
}
