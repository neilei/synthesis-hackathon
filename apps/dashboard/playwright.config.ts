/**
 * Playwright test config. UI tests (mocked API) by default; integration tests
 * (real agent) opt-in via INTEGRATION=1.
 *
 * @module @veil/dashboard/playwright.config
 */
import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
const runIntegration = !!process.env.INTEGRATION;
const dashPort = Number(process.env.DASH_PORT) || 3100;

export default defineConfig({
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${dashPort}`,
    trace: "on-first-retry",
  },
  projects: [
    // UI tests (mocked API) — always run
    {
      name: "ui",
      testDir: "./tests",
      testIgnore: ["**/integration/**"],
      use: { ...devices["Desktop Chrome"] },
    },
    // Integration tests (real agent server) — opt-in via INTEGRATION=1
    ...(runIntegration
      ? [
          {
            name: "integration",
            testDir: "./tests/integration",
            use: { ...devices["Desktop Chrome"] },
            // Integration tests are serial — deploy changes server state
            fullyParallel: false,
          },
        ]
      : []),
  ],
  webServer: {
    command: `npx next dev --webpack --port ${dashPort}`,
    url: `http://localhost:${dashPort}`,
    reuseExistingServer: !isCI,
  },
});
