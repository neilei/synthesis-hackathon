/**
 * Playwright e2e tests for the Audit tab: delegation report display.
 *
 * The Audit tab is now reached via Configure preview → Deploy (which requires
 * wallet connection for delegation signing). Since we can't mock wagmi in
 * Playwright, we test the Audit component's rendering by verifying the preview
 * step in Configure shows the same audit report data inline.
 *
 * @module @veil/dashboard/tests/audit.spec
 */
import { test, expect } from "@playwright/test";

const MOCK_PARSE_RESPONSE = {
  parsed: {
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
    maxSlippage: 0.005,
    driftThreshold: 0.05,
    maxTradesPerDay: 10,
  },
  audit: {
    allows: [
      "Swap ETH ↔ USDC on Uniswap V3",
      "Rebalance within 5% drift threshold",
    ],
    prevents: [
      "Transfer to external addresses",
      "Swap tokens not in allocation",
    ],
    worstCase: "Maximum daily loss: $200",
    warnings: ["Slippage tolerance is low — may fail in volatile markets"],
  },
};

test.describe("Audit Report (via Configure Preview)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/parse-intent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      }),
    );

    await page.goto("/");
    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC, $200/day, 7 days");
    await page.getByRole("button", { name: /preview strategy/i }).click();

    await expect(page.getByText("Your Strategy")).toBeVisible({
      timeout: 5000,
    });
  });

  test("shows parsed intent with allocation bar", async ({ page }) => {
    await expect(page.getByText("ETH 60%")).toBeVisible();
    await expect(page.getByText("USDC 40%")).toBeVisible();
  });

  test("shows key-value grid with correct values", async ({ page }) => {
    await expect(page.getByText("Daily Budget")).toBeVisible();
    await expect(page.getByText("$200", { exact: true })).toBeVisible();
    await expect(page.getByText("Time Window")).toBeVisible();
    await expect(page.getByText("7 days", { exact: true })).toBeVisible();
    await expect(page.getByText("Max Slippage")).toBeVisible();
    await expect(page.getByText("0.5%")).toBeVisible();
    await expect(page.getByText("Drift Threshold", { exact: true })).toBeVisible();
    await expect(page.getByText("5.0%")).toBeVisible();
    await expect(page.getByText("Max Trades/Day")).toBeVisible();
    await expect(page.getByText("10")).toBeVisible();
  });

  test("shows delegation report with allows section", async ({ page }) => {
    await expect(page.getByText("Delegation Report")).toBeVisible();
    await expect(page.getByText("Allows")).toBeVisible();
    await expect(
      page.getByText("Swap ETH ↔ USDC on Uniswap V3"),
    ).toBeVisible();
    await expect(
      page.getByText("Rebalance within 5% drift threshold"),
    ).toBeVisible();
  });

  test("shows prevents section", async ({ page }) => {
    await expect(page.getByText("Prevents")).toBeVisible();
    await expect(
      page.getByText("Transfer to external addresses"),
    ).toBeVisible();
    await expect(
      page.getByText("Swap tokens not in allocation"),
    ).toBeVisible();
  });

  test("shows worst case section", async ({ page }) => {
    await expect(page.getByText("Worst Case")).toBeVisible();
    await expect(page.getByText("Maximum daily loss: $200")).toBeVisible();
  });

  test("shows warnings section", async ({ page }) => {
    await expect(page.getByText("Warnings")).toBeVisible();
    await expect(
      page.getByText("Slippage tolerance is low"),
    ).toBeVisible();
  });

  test("shows sponsor badges", async ({ page }) => {
    await expect(page.getByText("Powered by Venice")).toBeVisible();
    await expect(
      page.getByText("Enforced by MetaMask Delegation"),
    ).toBeVisible();
  });

  test("shows wallet connection prompt (no wallet connected)", async ({ page }) => {
    await expect(
      page.getByText("Connect your wallet to deploy the agent."),
    ).toBeVisible();
  });
});
