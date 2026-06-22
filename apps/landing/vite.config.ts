import { defineConfig } from "vite";

// Benzo root chooser. Plain HTML + the wallet's stage video as the backdrop.
// The two destinations are env-overridable for production; in dev they default
// to the local wallet (5175) and console (5174) inside index.html.
export default defineConfig({
  server: { port: 5173 },
});
