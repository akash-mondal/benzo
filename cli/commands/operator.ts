// benzo operator view — DESIGN §1 operator-blind: N × C and opaque blobs only.
import path from "node:path";
import { loadPublicAuction, operatorView } from "../../api/public-auction";

export const noun = "operator";
export const verb = "view";
export const help = "benzo operator view --dir <public-auction-dir> — only C + opaque blobs (no bid plaintext)";

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(help + "\n");
    return 0;
  }
  let dir = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = path.resolve(argv[++i] ?? "");
    else {
      process.stderr.write(`ERROR operator usage: ${help}\n`);
      return 2;
    }
  }
  if (!dir) {
    process.stderr.write(`ERROR operator usage: ${help}\n`);
    return 2;
  }
  try {
    const pub = loadPublicAuction(dir);
    process.stdout.write(JSON.stringify(operatorView(pub)) + "\n");
    return 0;
  } catch (e) {
    process.stderr.write(`ERROR operator ${(e as Error).message}\n`);
    return 1;
  }
}
