import { defineConfig } from "@playwright/test";

const projects = [{ name: "default", testMatch: /seal-open\.spec\.ts/ }];
if (process.env.BNZ_LIVE === "1") {
  projects.push({ name: "testnet-golden-path", testMatch: /testnet-golden-path\.spec\.ts/ });
  projects.push({ name: "live", testMatch: /(seal-open|testnet-golden-path)\.spec\.ts/ });
  projects.push({ name: "auction-core", testMatch: /auction-core\.spec\.ts/ });
  projects.push({ name: "settle-crash", testMatch: /settle-crash\.spec\.ts/ });
  projects.push({ name: "cli-auction", testMatch: /cli-auction\.spec\.ts/ });
  projects.push({ name: "buyback-mode", testMatch: /buyback-mode\.spec\.ts/ });
  projects.push({ name: "markets", testMatch: /markets\.spec\.ts/ });
}

export default defineConfig({
  testDir: "e2e",
  outputDir: "tmp/e2e/test-results",
  retries: 0,
  forbidOnly: true,
  workers: process.env.BNZ_LIVE === "1" ? 1 : 2,
  reporter: [["./e2e/lib/reporter.ts"], ["json", { outputFile: "tmp/e2e/report.json" }]],
  globalSetup: "./e2e/lib/global-setup.ts",
  globalTeardown: "./e2e/lib/global-teardown.ts",
  use: { browserName: "chromium", headless: true },
  projects,
});
