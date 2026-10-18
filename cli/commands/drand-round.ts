// benzo drand round — which pinned quicknet round releases at or after a UTC instant, and its exact release
// time. No network: the quicknet parameters are pinned in manifest/schema.ts (QUICKNET). The formula is the
// one the harness computes the manifest's R with (tools/repro/markets.ts): R = 1 + ceil((t - genesis) / period),
// so R's release instant (genesis + period x (R - 1)) is the first round at or after t.
import { QUICKNET, requireThat } from "../../manifest/schema";

export const noun = "drand", verb = "round";
export const help = "benzo drand round --at <ISO-8601 UTC, e.g. 2026-10-18T12:00:00Z> — print {round, release_utc} for the pinned drand quicknet: the first round whose release instant (genesis + 3 s x (round - 1)) is at or after the given time; no network";

export async function run(argv: string[]): Promise<number | object> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] !== "--at" || argv[i + 1] === undefined) {
      process.stderr.write(`ERROR drand round usage: ${help}\n`);
      return 2;
    }
    o.at = argv[i + 1];
  }
  try {
    requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(o.at ?? ""), "at must be an ISO-8601 UTC instant (e.g. 2026-10-18T12:00:00Z)");
    const at = Date.parse(o.at);
    requireThat(Number.isFinite(at), "at must be an ISO-8601 UTC instant");
    // The harness formula, on exact second arithmetic. A time before quicknet genesis would give round < 1;
    // the first real round (1, releasing at genesis) is the honest answer there.
    const round = Math.max(1, 1 + Math.ceil((at / 1000 - QUICKNET.genesis) / QUICKNET.period));
    const release = QUICKNET.genesis + (round - 1) * QUICKNET.period;
    return { round, release_utc: new Date(release * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") };
  } catch (e) {
    process.stderr.write(`ERROR drand round ${(e as Error).message}\n`);
    return 1;
  }
}
