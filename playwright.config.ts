import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  globalTeardown: "./scripts/e2e-global-teardown.mjs",
  use: {
    baseURL: "http://localhost:41737",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox-smoke", testMatch: /session\.spec\.ts/u, use: { ...devices["Desktop Firefox"] } },
    { name: "webkit-smoke", testMatch: /session\.spec\.ts/u, use: { ...devices["Desktop Safari"] } },
    { name: "mobile-smoke", testMatch: /session\.spec\.ts/u, use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node scripts/start-e2e-server.mjs",
    url: "http://localhost:41737/api/v1/health/live",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
