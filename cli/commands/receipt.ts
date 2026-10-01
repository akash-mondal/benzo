// benzo receipt show — inclusion receipt + settlement receipt if any (T2 receipt shape).
// Flags, not positional arguments (R20): --dir, --ciphertext-hash, optional --receipt.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Signed } from "../../manifest/schema";
import { loadPublicAuction, receiptShow } from "../../api/public-auction";

export const noun = "receipt";
export const verb = "show";
export const help = "benzo receipt show --dir <public-auction-dir> --ciphertext-hash <hex> [--receipt <signed-receipt.json>]";

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(help + "\n");
    return 0;
  }
  let dir = "", ciphertextHash = "", packet: Signed | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = path.resolve(argv[++i] ?? "");
    else if (argv[i] === "--ciphertext-hash") ciphertextHash = argv[++i] ?? "";
    else if (argv[i] === "--receipt") packet = JSON.parse(readFileSync(argv[++i] ?? "", "utf8")) as Signed;
    else {
      process.stderr.write(`ERROR receipt usage: ${help}\n`);
      return 2;
    }
  }
  if (!dir || !/^[0-9a-f]{64}$/.test(ciphertextHash)) {
    process.stderr.write(`ERROR receipt usage: ${help}\n`);
    return 2;
  }
  try {
    const pub = loadPublicAuction(dir);
    process.stdout.write(JSON.stringify(receiptShow(pub, ciphertextHash, packet), null, 2) + "\n");
    return 0;
  } catch (e) {
    process.stderr.write(`ERROR receipt ${(e as Error).message}\n`);
    return 1;
  }
}
