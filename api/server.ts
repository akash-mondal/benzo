// Read-only JSON API over a public auction directory. Bind 127.0.0.1 by default; never returns bid plaintext.
import http from "node:http";
import path from "node:path";
import { freezeBoard, loadPublicAuction, operatorView, receiptShow, resultHash } from "./public-auction";

export type ServerOptions = { dir: string; host?: string; port?: number };

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(payload);
}

export function startServer(options: ServerOptions): http.Server {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });
      const parts = url.pathname.split("/").filter(Boolean);
      let pub;
      try {
        pub = loadPublicAuction(options.dir);
      } catch (e) {
        return send(res, 400, { valid: false, error: (e as Error).message });
      }
      if (parts[0] === "auction" && parts[1]) {
        if (parts[1] !== pub.manifest.auction_id) return send(res, 404, { error: "unknown auction id" });
        return send(res, 200, {
          valid: true,
          auction_id: pub.manifest.auction_id,
          manifest_hash: pub.manifest_hash,
          result_hash: resultHash(pub),
          lot: pub.manifest.lot,
          supply: pub.manifest.supply,
          C_zats: pub.manifest.C_zats,
          mode: pub.result.mode,
          clearing_price_zats: pub.result.clearing_price_zats,
          freeze_root: pub.frozen.root,
          leaf_count: pub.frozen.leaf_count,
          T_submit: pub.manifest.T_submit,
          T_freeze: pub.manifest.T_freeze,
          R: pub.manifest.drand.R,
          settled: Boolean(pub.settlement),
        });
      }
      if (parts[0] === "operator" && parts.length === 1) return send(res, 200, operatorView(pub));
      if (parts[0] === "freeze" && parts.length === 1) return send(res, 200, freezeBoard(pub));
      if (parts[0] === "result" && parts.length === 1) return send(res, 200, JSON.parse(pub.resultBytes.toString("utf8")));
      if (parts[0] === "receipt" && parts[1]) {
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

const argv = process.argv.slice(2);
if (argv.length) {
  let dir = "", host = "127.0.0.1", port = 8787;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = path.resolve(argv[++i]);
    else if (argv[i] === "--host") host = argv[++i];
    else if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--help") {
      process.stdout.write("api server --dir <public-auction-dir> [--host 127.0.0.1] [--port 8787]\n");
      process.exit(0);
    } else {
      process.stderr.write(`ERROR api usage\n`);
      process.exit(2);
    }
  }
  if (!dir) {
    process.stderr.write("ERROR api usage: --dir required\n");
    process.exit(2);
  }
  const server = startServer({ dir, host, port });
  server.on("listening", () => process.stdout.write(`api listening http://${host}:${port} dir=${dir}\n`));
}
