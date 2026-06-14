/**
 * PWA entry. Builds the wired wallet from env-injected config; the UI layer
 * (added later) renders over `wallet.client`. No screens here — this is the
 * composition + bootstrap only.
 */
import { createWebWallet } from "./wallet.js";

// Config is injected at build/deploy time (Vite define / a /config.json fetch).
// Kept minimal here — the UI supplies the rest.
declare const __BENZO_CONFIG__: Parameters<typeof createWebWallet>[0] | undefined;

export function boot() {
  const cfg = typeof __BENZO_CONFIG__ !== "undefined" ? __BENZO_CONFIG__ : undefined;
  if (!cfg) {
    const el = document.getElementById("app");
    if (el) el.textContent = "Benzo wallet — configure __BENZO_CONFIG__ to boot.";
    return undefined;
  }
  return createWebWallet(cfg);
}

boot();
