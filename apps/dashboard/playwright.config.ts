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
const agentPort = Number(process.env.AGENT_PORT) || 3148;
const TEST_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

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
            timeout: 120_000,
          },
        ]
      : []),
  ],
  webServer: [
    // Dashboard dev server — always runs
    {
      command: `npx next dev --port ${dashPort}`,
      url: `http://localhost:${dashPort}`,
      reuseExistingServer: !isCI,
      env: {
        NEXT_PUBLIC_TEST_WALLET: runIntegration ? TEST_WALLET : "",
        ...(runIntegration
          ? { AGENT_API_URL: `http://localhost:${agentPort}` }
          : {}),
      },
    },
    // Agent server — only for integration tests
    ...(runIntegration
      ? [
          {
            command: "npx tsx ../../packages/agent/src/server.ts",
            url: `http://localhost:${agentPort}/api/auth/nonce?wallet=0x1`,
            reuseExistingServer: !isCI,
            env: {
              PORT: String(agentPort),
              DB_PATH: `data/test-pw-${Date.now()}.db`,
            },
            timeout: 30_000,
          },
        ]
      : []),
  ],
});
