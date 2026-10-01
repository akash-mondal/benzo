// benzo verify — independent gate R: public inputs only, cold copy, ERROR lines on corruption.
import { checkPublicAuction, loadPublicAuction } from "../../api/public-auction";

export const noun = "verify";
export const verb = "";
export const help = "benzo verify <public-auction-dir> — reproduce clear + settlement accounting from public inputs only (cold copy)";

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.length === 0) {
    process.stdout.write(help + "\n");
    return argv.includes("--help") ? 0 : 2;
  }
  if (argv.length !== 1) {
    process.stderr.write(`ERROR verify usage: ${help}\n`);
    return 2;
  }
  try {
    const pub = loadPublicAuction(argv[0]);
    const checks = checkPublicAuction(pub);
    let failed = false;
    for (const c of checks) {
      if (c.error) {
        failed = true;
        process.stderr.write(`ERROR ${c.id} ${c.error}\n`);
      } else {
        process.stdout.write(`OK ${c.id}\n`);
      }
    }
    return failed ? 1 : 0;
  } catch (e) {
    process.stderr.write(`ERROR verify ${(e as Error).message}\n`);
    return 1;
  }
}
