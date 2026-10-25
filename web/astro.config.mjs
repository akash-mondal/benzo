import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bidderShims } from "./src/lib/bidder/vite-plugin.ts";

const GATEWAY = process.env.BNZ_WEB_GATEWAY ?? "http://127.0.0.1:8790";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  integrations: [react()],
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  vite: {
    // The bid page imports the repo's own envelope/manifest code (../envelope, ../manifest) through three browser shims.
    plugins: [bidderShims(REPO), tailwindcss()],
    server: { proxy: { "/api": GATEWAY, "/sealer": GATEWAY, "/dl": GATEWAY }, fs: { allow: [REPO] } },
    build: { target: "es2022" },
    optimizeDeps: { esbuildOptions: { target: "es2022" } },
  },
});
