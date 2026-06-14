import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// COOP/COEP make the page cross-origin isolated, which enables SharedArrayBuffer
// + WASM threads — required for acceptable client-side Groth16 proving. For
// static hosts that can't set headers, public/coi-serviceworker.js installs them.
const crossOriginIsolation = {
  name: "cross-origin-isolation",
  configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
    server.middlewares.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
};

// Serve the compiled circuit artifacts at /circuits/<name>.{wasm,zkey} from the
// monorepo build dir during dev (they're large; production copies/ships them).
const REPO = join(__dirname, "..", "..");
const serveCircuits = {
  name: "serve-circuits",
  configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
    server.middlewares.use(
      (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; statusCode: number; end: (b?: unknown) => void }, next: () => void) => {
        const m = req.url?.match(/^\/circuits\/([a-z_]+)\.(wasm|zkey)$/);
        if (!m) return next();
        const [, name, ext] = m;
        const file =
          ext === "wasm"
            ? join(REPO, "circuits", "build", name, `${name}_js`, `${name}.wasm`)
            : join(REPO, "circuits", "build", name, `${name}.zkey`);
        if (!existsSync(file)) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader("Content-Type", "application/octet-stream");
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        import("node:fs").then((fs) => fs.createReadStream(file).pipe(res as never));
      },
    );
  },
};

export default defineConfig({
  plugins: [
    nodePolyfills({ include: ["buffer", "crypto", "stream", "util", "process"] }),
    crossOriginIsolation,
    serveCircuits,
  ],
  build: { target: "esnext" },
  worker: { format: "es" },
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
});
