import { defineConfig, devices } from "@playwright/test";

// Deliberately has no webServer or teardown: connect to npm run dev and retain data.
export default defineConfig({
  testDir: "./evaluation/live-personas",
  testMatch: "live.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 0,
  reporter: "list",
  outputDir: ".artifacts/live-evaluation/playwright-output",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:5173",
    trace: "off",
    video: "off",
    screenshot: "off",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
});
