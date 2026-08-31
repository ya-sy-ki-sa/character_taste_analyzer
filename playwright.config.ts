import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

function webkitHostDependenciesAvailable(): boolean {
  if (process.platform !== "linux") return true;
  try {
    return execFileSync("ldconfig", ["-p"], { encoding: "utf8" }).includes("libgtk-4.so.1");
  } catch {
    return true;
  }
}

const crossBrowserProjects = [
  { name: "firefox-smoke", testMatch: /session\.spec\.ts/u, use: { ...devices["Desktop Firefox"] } },
  ...(webkitHostDependenciesAvailable()
    ? [{ name: "webkit-smoke", testMatch: /session\.spec\.ts/u, use: { ...devices["Desktop Safari"] } }]
    : []),
  { name: "mobile-smoke", testMatch: /session\.spec\.ts/u, use: { ...devices["Pixel 7"] } },
];

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, ...crossBrowserProjects],
  webServer: {
    command: "node scripts/start-e2e-server.mjs",
    url: "http://localhost:41737/api/v1/health/live",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
