// The site's own e2e (separate from the repo's gate RG in ../playwright.config.ts): the built site served by the real
// gateway over the operator's published auction directories. `offline` needs no chain; `live` needs the house operator.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.BNZ_WEB_TEST_PORT ?? 8791);
export default defineConfig({
  testDir: "e2e",
  outputDir: "tmp/test-results",
  retries: 0,
  forbidOnly: true,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"], ["json", { outputFile: "tmp/report.json" }]],
  use: {
    browserName: "chromium", headless: true, baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    acceptDownloads: true,
  },
  webServer: process.env.BNZ_WEB_TEST_URL ? undefined : {
    // Started rounds go to a scratch folder (wiped per run), never the operator's state.
    command: `rm -rf tmp/requests-e2e && BNZ_WEB_REQUESTS_DIR=tmp/requests-e2e BNZ_WEB_REQUEST_PER_IP=1000 BNZ_WEB_REQUEST_LIMIT=1000 node gateway/dist/server.mjs --port ${PORT}`, url: `http://127.0.0.1:${PORT}/api/chain`, reuseExistingServer: false, timeout: 60_000,
  },
  projects: [
    { name: "offline", testMatch: /(site|bid-offline|start)\.spec\.ts/ },
    { name: "live", testMatch: /live\.spec\.ts/, timeout: 3 * 3600_000 },
  ],
});
