// Read-only JSON API over a public auction directory. Bind 127.0.0.1 by default; never returns bid plaintext.
import { readFileSync } from "node:fs";
import { hash, requireThat } from "../manifest/schema";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkPublicAuction, freezeBoard, loadPublicAuction, operatorView, receiptShow, resultHash } from "./public-auction";
import { deriveClaimOpenings } from "../cli/published-beacon";

export type ServerOptions = { dir: string; host?: string; port?: number; signer?: string };

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(payload);
}

export function startServer(options: ServerOptions): http.Server {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });
      const parts = url.pathname.split("/").filter(Boolean);
      let pub;
      try {
        pub = loadPublicAuction(options.dir, { signer: options.signer });
      } catch (e) {
        return send(res, 400, { valid: false, error: (e as Error).message });
      }
      if (parts[0] === "auction" && parts[1]) {
        if (parts[1] !== pub.manifest.auction_id) return send(res, 404, { error: "unknown auction id" });
        // (reviewer G4): a document with deposit claims and no published beacon fails CLOSED
        // with the verify ERROR — the claims check reports the memo it cannot open — never an exception
        // or a 500. `errors` carries the same ERROR lines `benzo verify` prints.
        let claimOpenings: Map<number, string | null>;
        try {
          claimOpenings = await deriveClaimOpenings(pub.claims ?? [], pub.beacon);
        } catch {
          claimOpenings = new Map();
        }
        const failed = checkPublicAuction(pub, { claimOpenings }).filter(c => c.error);
        // A manifest failure means the document cannot be trusted at all (same verdict as `benzo verify`).
        const manifestBroken = failed.find(c => c.id === "manifest");
        if (manifestBroken) return send(res, 400, { valid: false, error: `manifest ${manifestBroken.error}` });
        // `valid` covers only the checks that apply to the current state.
        return send(res, 200, {
          valid: failed.length === 0,
          errors: failed,
          auction_id: pub.manifest.auction_id,
          manifest_hash: pub.manifest_hash,
          state: pub.state,
          lot: pub.manifest.lot ?? null,
          lots: pub.manifest.lots ?? null,
          supply: pub.manifest.supply,
          C_zats: pub.manifest.C_zats,
          mode: pub.result?.mode ?? null,
          clearing_price_zats: pub.result?.clearing_price_zats ?? null,
          result_hash: resultHash(pub),
          freeze_root: pub.frozen?.root ?? null,
          leaf_count: pub.frozen?.leaf_count ?? null,
          T_submit: pub.manifest.T_submit,
          T_freeze: pub.manifest.T_freeze,
          R: pub.manifest.drand.R,
          settled: Boolean(pub.settlement),
        });
      }
      if (parts[0] === "operator" && parts.length === 1) return send(res, 200, operatorView(pub));
      if (parts[0] === "freeze" && parts.length === 1) return send(res, 200, freezeBoard(pub));
      // Result and receipt data arrive later in the lifecycle; until then the state says so (409).
      if (parts[0] === "result" && parts.length === 1) {
        if (!pub.result || !pub.resultBytes) return send(res, 409, { ready: false, state: pub.state });
        return send(res, 200, JSON.parse(pub.resultBytes.toString("utf8")));
      }
      if (parts[0] === "allocation" && parts.length === 1) {
        // The hash-checked delivery channel is keyed on the HOST-SIGNED
        // `benzo-delivery-list-v1` statement (delivery_list), not the `result.allocation_file_hash`
        // field F4 removed — pre-F4 docs fall back to the result field. The file is checked against whichever
        // is present, so the channel the route exists to protect actually serves.
        const commit = pub.deliveryList?.allocation_file_hash ?? pub.result?.allocation_file_hash;
        if (!commit) return send(res, 409, { ready: false, state: pub.state });
        const bytes = readFileSync(path.join(pub.dir, "allocation.json"));
        requireThat(hash(bytes) === commit, "launch allocation file hash");
        return send(res, 200, JSON.parse(bytes.toString("utf8")));
      }
      if (parts[0] === "receipt" && parts[1]) {
        if (!pub.frozen) return send(res, 409, { ready: false, state: pub.state });
        return send(res, 200, receiptShow(pub, parts[1]));
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  });
  server.listen(port, host);
  return server;
}

// Standalone entry: `node api/dist/server.mjs --dir <public-auction-dir> [--host 127.0.0.1] [--port 8787] [--signer HEX]`.
// Guarded so importing startServer (cli/commands/api.ts) never parses the CLI's own argv.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  let dir = "", host = "127.0.0.1", port = 8787, signer: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = path.resolve(argv[++i] ?? "");
    else if (argv[i] === "--host") host = argv[++i] ?? "";
    else if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--signer") signer = argv[++i] ?? "";
    else if (argv[i] === "--help") {
      process.stdout.write("api server --dir <public-auction-dir> [--host 127.0.0.1] [--port 8787] [--signer <ed25519-spki-der-hex>]\n");
      process.exit(0);
    } else {
      process.stderr.write(`ERROR api usage\n`);
      process.exit(2);
    }
  }
  if (!dir || (signer !== undefined && !/^[0-9a-f]{88}$/.test(signer))) {
    process.stderr.write("ERROR api usage: --dir required, --signer must be 88 hex chars\n");
    process.exit(2);
  }
  try {
    // A --signer mismatch refuses to serve, same as every later request load.
    loadPublicAuction(dir, { signer });
  } catch (e) {
    process.stderr.write(`ERROR api ${(e as Error).message}\n`);
    process.exit(1);
  }
  const server = startServer({ dir, host, port, signer });
  server.on("listening", () => process.stdout.write(`api listening http://${host}:${port} dir=${dir}\n`));
  server.on("error", (e) => {
    process.stderr.write(`ERROR api ${e.message}\n`);
    process.exit(1);
  });
}
