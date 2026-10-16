// R77 (Reviewer G G-2): settle/plan.ts recomputes through clear/dist/cli.mjs = clearForMode -> attachSerials, which
// BLS-verifies the serial beacon against the pinned quicknet key. A forged beacon is refused there.
import { execFileSync } from "node:child_process";
import { loadPublicAuction } from "../../api/public-auction";
const pub = loadPublicAuction("docs/evidence/phase-5/markets/drop-a17/drop-cold");
if (!pub.serialBeacon) throw new Error("fixture has no serial beacon");
const input = (sig: string) => JSON.stringify({ manifest: pub.manifestPacket, signer: pub.signer, frozen: pub.frozen, opened: pub.opened, reserve_opening: pub.reserveOpening, serial_beacon: { ...pub.serialBeacon, signature: sig }, launch: pub.launchInput });
const clear = (sig: string) => { try { execFileSync(process.execPath, ["clear/dist/cli.mjs"], { input: input(sig), stdio: ["pipe", "pipe", "pipe"] }); return "ACCEPTED"; } catch (e: any) { return "REFUSED " + String(e.stderr ?? e.message).trim().split("\n").pop()!.slice(0, 100); } };
const real = pub.serialBeacon.signature, forged = (real[0] === "a" ? "b" : "a") + real.slice(1);
console.log(`published beacon: ${clear(real)}`);
console.log(`forged beacon (one hex digit changed, not a curve point): ${clear(forged)}`);
// R78 (Reviewer R F-5): the substituted signature is pinned here — quicknet round 32856451, the serial beacon published in
// docs/evidence/phase-5/markets/drop-a19/drop-cold/auction.json — a valid G1 point that is a real drand signature, but for a different round.
const OTHER_ROUND = "a59a1d946b14a2eff753cf86d13b7c92ca74a0bcd990865c33d02730227217bd4c46cf8347774b2287eedbfc7922514f";
console.log(`substituted beacon (quicknet round 32856451's real signature, a valid point, wrong round): ${clear(OTHER_ROUND)}`);
