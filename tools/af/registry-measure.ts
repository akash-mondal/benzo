// R-AF-5 measurement: over every committed settled document, which trust-registry errors does verify raise?
import { execFileSync } from "node:child_process";
import path from "node:path";
import { checkPublicAuction, loadPublicAuction } from "../../api/public-auction";
const files = execFileSync("git", ["ls-files", "docs/evidence"], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith("/auction.json"));
const tally = new Map<string, number>(); let docs = 0, loadFail = 0;
for (const f of files) {
  let pub;
  try { pub = loadPublicAuction(path.dirname(f)); } catch { loadFail++; continue; }
  if (!pub.settlement) continue;
  docs++;
  for (const c of checkPublicAuction(pub, {})) if (c.id === "trust-registry") tally.set(c.error!, (tally.get(c.error!) ?? 0) + 1);
}
console.log(`settled docs ${docs}, load failures ${loadFail}`);
for (const [e, n] of tally) console.log(`${n}x ${e}`);
for (const f of files) {
  let pub; try { pub = loadPublicAuction(path.dirname(f)); } catch { continue; }
  if (!pub.settlement) continue;
  const cs = checkPublicAuction(pub, {});
  if (cs.some((c) => c.id === "trust-registry")) console.log(f, JSON.stringify(cs.filter((c) => c.error).map((c) => [c.id, c.error!.slice(0, 100)])));
}
