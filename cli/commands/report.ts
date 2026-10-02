import { hash, requireThat } from "../../manifest/schema";
import { loadCompletePublicAuction } from "../../api/public-auction";
import { checkSeriesLink } from "../../clear/features";
import { buybackReport } from "../../adapters/buyback-report";
export const noun = "report", verb = "";
export const help = "benzo report --dir PUBLIC [--previous PUBLIC] — public recurring buyback window report";
export async function run(argv: string[]): Promise<number> {
  let dir = "", previous = "";
  for (let i=0;i<argv.length;i++) {
    if (argv[i] === "--dir") dir = argv[++i] ?? "";
    else if (argv[i] === "--previous") previous = argv[++i] ?? "";
    else { process.stderr.write(`ERROR report usage: ${help}\n`); return 2; }
  }
  try {
    requireThat(dir, "report directory"); const pub = loadCompletePublicAuction(dir);
    if (previous) {
      const prev = loadCompletePublicAuction(previous, { signer: pub.signer });
      requireThat(prev.result.mode === "buyback", "previous buyback mode");
      checkSeriesLink(pub.manifest.series, { link: prev.manifest.series, result_hash: hash(prev.resultBytes) });
    }
    process.stdout.write(JSON.stringify(buybackReport(pub),null,2)+"\n"); return 0;
  } catch(e) { process.stderr.write(`ERROR report ${(e as Error).message}\n`); return 1; }
}
