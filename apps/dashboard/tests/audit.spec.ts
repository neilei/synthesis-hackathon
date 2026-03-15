/**
 * Playwright e2e tests for the Audit tab: delegation report display.
 *
 * @module @veil/dashboard/tests/audit.spec
 */
import { test, expect } from "@playwright/test";

const MOCK_DEPLOY_RESPONSE = {
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

test.describe("Audit Screen", () => {
  test.beforeEach(async ({ page }) => {
    // Mock deploy API
    await page.route("**/api/deploy", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_DEPLOY_RESPONSE),
      }),
    );

    // Navigate and deploy to get to audit screen
    await page.goto("/");
    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC, $200/day, 7 days");
    await page.getByRole("button", { name: /compile & deploy/i }).click();

    // Wait for audit screen to render
    await expect(page.getByText("Parsed Intent")).toBeVisible({
      timeout: 5000,
    });
  });

  test("shows parsed intent section with allocation bar", async ({ page }) => {
    // Allocation bar labels
    await expect(page.getByText("ETH 60%")).toBeVisible();
    await expect(page.getByText("USDC 40%")).toBeVisible();
  });

  test("shows key-value grid with correct values", async ({ page }) => {
    await expect(page.getByText("Daily Budget")).toBeVisible();
    await expect(page.getByText("$200", { exact: true })).toBeVisible();
    await expect(page.getByText("Time Window")).toBeVisible();
    await expect(page.getByText("7 days")).toBeVisible();
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

  test("shows status bar with View Monitor button", async ({ page }) => {
    await expect(
      page.getByText("Agent is now monitoring your portfolio"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /view monitor/i }),
    ).toBeVisible();
  });

  test("View Monitor button navigates to monitor tab", async ({ page }) => {
    // Mock state API for monitor screen
    await page.route("**/api/state", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          running: true,
          cycle: 1,
          drift: 0.01,
          totalValue: 1000,
          trades: 0,
          totalSpent: 0,
          budgetTier: "$200",
          allocation: { ETH: 0.6, USDC: 0.4 },
          target: { ETH: 0.6, USDC: 0.4 },
          transactions: [],
          feed: [],
        }),
      }),
    );

    await page.getByRole("button", { name: /view monitor/i }).click();

    // Should be on monitor screen now
    await expect(page.getByText("Portfolio Value")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("$1,000.00")).toBeVisible();
  });
});
