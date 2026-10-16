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
console.log(`substituted beacon (a real drand signature of another round, a valid point): ${clear(process.argv[2])}`);
