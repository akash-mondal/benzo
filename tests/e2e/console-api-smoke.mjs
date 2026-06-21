/**
 * Smoke-test the console-api BFF org-treasury wiring directly (no HTTP):
 *   ensureOrgSetup (register_org + set_member_root) -> fundTreasury (shield into
 *   an M-of-N org note) -> computeTreasury (real dual-controlled balance).
 * Confirms the rewired chain.ts settles real USDC through the org path.
 *
 * Run: set -a; . ./.env; set +a; node tests/e2e/console-api-smoke.mjs
 */
import { computeTreasury, fundTreasury, payableBalance, liveStatus } from "../../apps/console-api/dist/chain.js";

const log = (...a) => console.log(...a);
log("=== console-api BFF org-treasury smoke ===");
log("liveStatus:", liveStatus());

const before = await computeTreasury();
log(`treasury before: total=${before.totalHidden.amount} live=${before.live}`);

log("fundTreasury(0.2 USDC = 2000000 stroops) -> shield into an M-of-N org note…");
const f = await fundTreasury("2000000"); // fundTreasury expects STROOPS (the HTTP route converts human->stroops)
log("fund result:", f);
if (!f.onChain) { console.error("❌ fundTreasury did not settle on-chain:", f.error); process.exit(1); }

const after = await computeTreasury();
log(`treasury after: total=${after.totalHidden.amount} live=${after.live}`);
const pay = await payableBalance();
log(`payableBalance: live=${pay.live} stroops=${pay.stroops}`);

if (BigInt(after.totalHidden.amount) <= BigInt(before.totalHidden.amount)) {
  console.error("❌ treasury balance did not increase after funding");
  process.exit(1);
}
log("\n✅ console-api BFF funds + reports the dual-controlled treasury via the org path (real USDC).");
