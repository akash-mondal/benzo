// benzo receipt show — inclusion receipt + settlement receipt if any (T2 receipt shape).
import { readFileSync } from "node:fs";
import type { Signed } from "../../manifest/schema";
import { loadPublicAuction, receiptShow } from "../../api/public-auction";

export const noun = "receipt";
export const verb = "show";
export const help = "benzo receipt show <public-auction-dir> <ciphertext-hash>\n       benzo receipt show <public-auction-dir> --receipt <signed-receipt.json>";

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.length === 0) {
    process.stdout.write(help + "\n");
    return argv.includes("--help") ? 0 : 2;
  }
  try {
    const dir = argv[0];
    let hashArg: string | undefined;
    let packet: Signed | undefined;
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === "--receipt") {
        const raw = JSON.parse(readFileSync(argv[++i], "utf8")) as Signed;
        packet = raw;
        if (!hashArg && typeof raw === "object" && raw !== null) {
          const decoded = JSON.parse(Buffer.from(String((raw as Signed).bytes), "base64").toString("utf8")) as { ciphertext_hash?: string };
          hashArg = decoded.ciphertext_hash;
        }
      } else if (/^[0-9a-f]{64}$/.test(argv[i])) hashArg = argv[i];
      else {
        process.stderr.write(`ERROR receipt usage: ${help}\n`);
        return 2;
      }
    }
    if (!dir || !hashArg) {
      process.stderr.write(`ERROR receipt usage: ${help}\n`);
      return 2;
    }
    const pub = loadPublicAuction(dir);
    process.stdout.write(JSON.stringify(receiptShow(pub, hashArg!, packet), null, 2) + "\n");
    return 0;
  } catch (e) {
    process.stderr.write(`ERROR receipt ${(e as Error).message}\n`);
    return 1;
  }
}
