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
    allows: ["Swap ETH ↔ USDC on Uniswap V3"],
    prevents: ["Transfer to external addresses"],
    worstCase: "Maximum daily loss: $200",
    warnings: [],
  },
};

function mockAgentState(
  page: import("@playwright/test").Page,
  overrides: Record<string, unknown> = {},
) {
  return page.route("**/api/state", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        running: true,
        cycle: 3,
        drift: 0.02,
        totalValue: 1500,
        trades: 1,
        totalSpent: 45,
        budgetTier: "$200",
        allocation: { ETH: 0.58, USDC: 0.42 },
        target: { ETH: 0.6, USDC: 0.4 },
        transactions: [
          {
            txHash:
              "0xabc123def456789012345678901234567890123456789012345678901234abcd",
            sellToken: "USDC",
            buyToken: "ETH",
            sellAmount: "45.00",
            status: "confirmed",
            timestamp: new Date().toISOString(),
          },
        ],
        feed: [],
        ...overrides,
      }),
    }),
  );
}

async function navigateToMonitor(page: import("@playwright/test").Page) {
  await page.route("**/api/deploy", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_DEPLOY_RESPONSE),
    }),
  );
  await page.goto("/");
  const textarea = page.getByPlaceholder(/60\/40/);
  await textarea.fill("60/40 ETH/USDC");
  await page.getByRole("button", { name: /compile & deploy/i }).click();
  await expect(page.getByText("Parsed Intent")).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: /view monitor/i }).click();
  await expect(page.getByText("Portfolio Value")).toBeVisible({
    timeout: 5000,
  });
}

test.describe("Monitor Screen", () => {
  test("tabs disabled before deploy", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("tab", { name: /monitor/i })).toBeDisabled();
    await expect(page.getByRole("tab", { name: /audit/i })).toBeDisabled();
  });

  test("shows stats cards with correct values", async ({ page }) => {
    await mockAgentState(page);
    await navigateToMonitor(page);

    await expect(page.getByText("Portfolio Value")).toBeVisible();
    await expect(page.getByText("$1,500.00")).toBeVisible();
    await expect(page.getByText("Current Drift")).toBeVisible();
    await expect(
      page.getByText("2.0%", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Trades Executed")).toBeVisible();
    await expect(page.getByText("Budget Spent")).toBeVisible();
  });

  test("shows allocation bars for current and target", async ({ page }) => {
    await mockAgentState(page);
    await navigateToMonitor(page);

    await expect(page.getByText("Allocation")).toBeVisible();
    await expect(page.getByText("Current", { exact: true })).toBeVisible();
    await expect(page.getByText("Target", { exact: true })).toBeVisible();
  });

  test("shows transaction with etherscan link", async ({ page }) => {
    await mockAgentState(page);
    await navigateToMonitor(page);

    await expect(page.getByText("Transactions")).toBeVisible();
    // Truncated hash should be visible
    await expect(page.getByText("0xabc1...abcd").first()).toBeVisible();
    // Should link to sepolia etherscan
    const txLink = page.getByRole("link", { name: /0xabc1/ }).first();
    await expect(txLink).toHaveAttribute(
      "href",
      /sepolia\.etherscan\.io\/tx\//,
    );
    await expect(txLink).toHaveAttribute("target", "_blank");
    // Pair display
    await expect(page.getByText("USDC → ETH").first()).toBeVisible();
  });

  test("shows empty transaction state", async ({ page }) => {
    await mockAgentState(page, { transactions: [], trades: 0 });
    await navigateToMonitor(page);

    await expect(
      page.getByText("No trades yet — agent is monitoring for drift"),
    ).toBeVisible();
  });

  test("shows running status with cycle count", async ({ page }) => {
    await mockAgentState(page);
    await navigateToMonitor(page);

    await expect(page.getByText("Cycle 3")).toBeVisible();
    await expect(page.getByText("Ethereum Sepolia")).toBeVisible();
  });

  test("shows sponsor badges", async ({ page }) => {
    await mockAgentState(page);
    await navigateToMonitor(page);

    await expect(page.getByText("Trades via Uniswap")).toBeVisible();
    await expect(page.getByText("Powered by Venice")).toBeVisible();
  });

  test("shows error banner when API fails", async ({ page }) => {
    await page.route("**/api/deploy", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_DEPLOY_RESPONSE),
      }),
    );
    // First state call succeeds, subsequent ones fail
    let callCount = 0;
    await page.route("**/api/state", (route) => {
      callCount++;
      if (callCount <= 1) {
        return route.fulfill({
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
        });
      }
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Agent server unreachable" }),
      });
    });

    await page.goto("/");
    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC");
    await page.getByRole("button", { name: /compile & deploy/i }).click();
    await expect(page.getByText("Parsed Intent")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /view monitor/i }).click();

    // Initial data shows fine
    await expect(page.getByText("Portfolio Value")).toBeVisible({ timeout: 5000 });

    // After polling fails, error banner appears (stale data still shown)
    await expect(page.getByText(/Failed to fetch state/)).toBeVisible({
      timeout: 15000,
    });
    // Retry button should be available
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
  });

  test("high drift shows danger color", async ({ page }) => {
    await mockAgentState(page, { drift: 0.08 }); // 8% drift > 5% threshold
    await navigateToMonitor(page);

    // The drift value should be visible
    const driftValue = page.getByText("8.0%", { exact: true }).first();
    await expect(driftValue).toBeVisible();
    // Verify it has the danger color class
    await expect(driftValue).toHaveClass(/text-accent-danger/);
  });
});
