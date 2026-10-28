import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bidderShims } from "./src/lib/bidder/vite-plugin.ts";

// The API the dev site talks to: the public testnet service unless BNZ_WEB_GATEWAY points at your own gateway.
const GATEWAY = process.env.BNZ_WEB_GATEWAY ?? "https://benzo.space";
const to = { target: GATEWAY, changeOrigin: true, secure: true };
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  integrations: [react()],
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  vite: {
    // The bid page imports the repo's own envelope/manifest code (../envelope, ../manifest) through three browser shims.
    plugins: [bidderShims(REPO), tailwindcss()],
    server: { proxy: { "/api": to, "/sealer": to, "/dl": to }, fs: { allow: [REPO] } },
    build: { target: "es2022" },
    optimizeDeps: { esbuildOptions: { target: "es2022" } },
  },
});
