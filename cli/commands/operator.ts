// benzo operator view — DESIGN §1 operator-blind: N × C and opaque blobs only.
import { loadPublicAuction, operatorView } from "../../api/public-auction";

export const noun = "operator";
export const verb = "view";
export const help = "benzo operator view <public-auction-dir> — only C + opaque blobs (no bid plaintext)";

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.length === 0) {
    process.stdout.write(help + "\n");
    return argv.includes("--help") ? 0 : 2;
  }
  if (argv.length !== 1) {
    process.stderr.write(`ERROR operator usage: ${help}\n`);
    return 2;
  }
  try {
    const pub = loadPublicAuction(argv[0]);
    process.stdout.write(JSON.stringify(operatorView(pub)) + "\n");
    return 0;
  } catch (e) {
    process.stderr.write(`ERROR operator ${(e as Error).message}\n`);
    return 1;
  }
}
