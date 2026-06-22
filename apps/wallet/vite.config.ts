import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The Stellar SDK (via @benzo/core) expects Node globals in the browser. Map
  // `global` → globalThis and pre-bundle the `buffer` polyfill (declared in
  // package.json) so its named `Buffer` export resolves; main.tsx sets the global.
  define: { global: "globalThis" },
  // `buffer/` (trailing slash) forces the npm polyfill over the Node builtin name,
  // which Vite would otherwise externalize to an empty stub in the browser.
  resolve: { alias: { buffer: "buffer/" } },
  optimizeDeps: { include: ["buffer"] },
  server: { port: 5175, proxy: { "/api": "http://localhost:8791" } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/test/setup.ts" },
});
