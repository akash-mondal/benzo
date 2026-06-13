/**
 * @benzo/integrations — env-keyed adapters for the Benzo corridor's external
 * edges, each following the same pattern as @benzo/kyc: a small interface, a
 * real provider behind an env key, and a key-free Mock so the testnet corridor
 * runs with zero credentials. Set the env key to switch any edge to live.
 *
 *   screening : Range / Human ID  (env RANGE_API_KEY / HUMAN_ID_CONTRACT)
 *   onramp    : Stripe Crypto     (env STRIPE_SECRET_KEY)
 *   cctp      : Circle CCTP V2    (env CIRCLE_API_KEY; sandbox is key-free)
 *   anchors   : SEP-24 presets    (env ANCHOR_PRESET: benzo | moneygram | alfred)
 *
 * Compliance shape: screening is the ALLOW side; the DENY side stays on-chain
 * as the ASP non-membership proof enforced at unshield. KYC lives in @benzo/kyc.
 */

export * from "./screening.js";
export * from "./onramp.js";
export * from "./cctp.js";
export * from "./anchors.js";
