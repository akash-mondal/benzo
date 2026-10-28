// benzo api serve — start the read-only JSON API over a public auction directory (--signer per item 5).
import path from "node:path";
import { loadPublicAuction } from "../../api/public-auction";
import { startServer } from "../../api/server";

export const noun = "api";
export const verb = "serve";
export const help = "benzo api serve --dir <public-auction-dir> [--host 127.0.0.1] [--port 8787] [--signer <ed25519-spki-der-hex>]";

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(help + "\n");
    return 0;
  }
  let dir = "", host = "127.0.0.1", port = 8787, signer: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = path.resolve(argv[++i] ?? "");
    else if (argv[i] === "--host") host = argv[++i] ?? "";
    else if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--signer") signer = argv[++i] ?? "";
    else {
      process.stderr.write(`ERROR api usage: ${help}\n`);
      return 2;
    }
  }
  if (!dir || (signer !== undefined && !/^[0-9a-f]{88}$/.test(signer))) {
    process.stderr.write(`ERROR api usage: ${help}\n`);
    return 2;
  }
  try {
    // A --signer mismatch refuses to serve, same as every later request load.
    loadPublicAuction(dir, { signer });
  } catch (e) {
    process.stderr.write(`ERROR api ${(e as Error).message}\n`);
    return 1;
  }
  const server = startServer({ dir, host, port, signer });
  server.on("listening", () => process.stdout.write(`api listening http://${host}:${port} dir=${dir}\n`));
  server.on("error", (e) => {
    process.stderr.write(`ERROR api ${e.message}\n`);
    process.exitCode = 1;
  });
  return 0;
}
