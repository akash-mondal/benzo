/**
 * Network identity - 12-factor (env-driven) so a console build targets testnet OR
 * mainnet WITHOUT any code change. Testnet defaults keep dev/CI zero-config; a
 * mainnet build sets VITE_BENZO_NETWORK=public. This removes the "hardcoded
 * testnet" smell from explorer links and the live badge: every "View on explorer"
 * receipt and every "Network" label derives from here, so a non-testnet receipt
 * deep-links to the right explorer instead of pointing at a tx that doesn't exist.
 *
 * Mirrors apps/wallet/src/lib/network.ts. PUBLIC: nothing secret is client-side.
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;

/** "testnet" (default) | "public". Normalized from VITE_BENZO_NETWORK. */
export const NETWORK = env.VITE_BENZO_NETWORK === "public" || env.VITE_BENZO_NETWORK === "pubnet" ? "public" : "testnet";

/** Human label for the active network - never hardcode "testnet" on a money screen. */
export const NETWORK_LABEL = NETWORK === "public" ? "Mainnet" : "Testnet";
