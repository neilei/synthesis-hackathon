/**
 * Playwright e2e tests for the Configure tab: form input, presets, preview flow.
 *
 * Note: The full deploy flow (grant permissions → submit) requires a connected
 * wallet which can't be mocked in Playwright without a real browser extension.
 * These tests cover the Preview step (parse intent via Venice) which doesn't
 * require wallet connection.
 *
 * @module @veil/dashboard/tests/configure.spec
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
    maxPerTradeUsd: 200,
  },
  audit: {
    allows: ["Swap ETH ↔ USDC on Uniswap V3"],
    prevents: ["Transfer to external addresses"],
    worstCase: "Maximum daily loss: $200",
    warnings: [],
  },
};

test.describe("Configure Screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads with Configure tab active", async ({ page }) => {
    const configureTab = page.getByRole("tab", { name: /configure/i });
    await expect(configureTab).toHaveAttribute("aria-selected", "true");
  });

  test("shows VEIL wordmark", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "VEIL" })).toBeVisible();
  });

  test("textarea accepts input", async ({ page }) => {
    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("70/30 ETH/USDC, $100/day, 14 days");
    await expect(textarea).toHaveValue("70/30 ETH/USDC, $100/day, 14 days");
  });

  test("preview button disabled when textarea empty", async ({ page }) => {
    const previewBtn = page.getByRole("button", { name: /preview strategy/i });
    await expect(previewBtn).toBeDisabled();
  });

  test("preview button enabled when textarea has text", async ({ page }) => {
    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC");
    const previewBtn = page.getByRole("button", { name: /preview strategy/i });
    await expect(previewBtn).toBeEnabled();
  });

  test("preset buttons fill textarea", async ({ page }) => {
    const preset = page.getByRole("button", {
      name: /60\/40 ETH\/USDC, \$200\/day, 7 days/,
    });
    await preset.click();
    const textarea = page.getByPlaceholder(/60\/40/);
    await expect(textarea).toHaveValue("60/40 ETH/USDC, $200/day, 7 days");
  });

  test("all three preset buttons are visible", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /60\/40 ETH\/USDC, \$200\/day/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /80\/20 ETH\/USDC/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /50\/50 split/ }),
    ).toBeVisible();
  });

  test("shows loading state during preview", async ({ page }) => {
    await page.route("**/api/parse-intent", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      });
    });

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC");
    await page.getByRole("button", { name: /preview strategy/i }).click();

    await expect(
      page.getByText("Analyzing your strategy..."),
    ).toBeVisible();
    await expect(textarea).toBeDisabled();
  });

  test("shows parsed strategy preview after parsing", async ({ page }) => {
    await page.route("**/api/parse-intent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      }),
    );

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC, $200/day, 7 days");
    await page.getByRole("button", { name: /preview strategy/i }).click();

    await expect(page.getByText("Your Strategy")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("ETH 60%")).toBeVisible();
    await expect(page.getByText("USDC 40%")).toBeVisible();
    await expect(page.getByText("$200", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("7 days", { exact: true }).first()).toBeVisible();
  });

  test("shows audit report after parsing", async ({ page }) => {
    await page.route("**/api/parse-intent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      }),
    );

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC");
    await page.getByRole("button", { name: /preview strategy/i }).click();

    await expect(page.getByText("Permission Report")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Swap ETH ↔ USDC on Uniswap V3")).toBeVisible();
    await expect(page.getByText("Transfer to external addresses")).toBeVisible();
    await expect(page.getByText("Maximum daily loss: $200")).toBeVisible();
  });

  test("shows wallet connection prompt after preview", async ({ page }) => {
    await page.route("**/api/parse-intent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      }),
    );

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC");
    await page.getByRole("button", { name: /preview strategy/i }).click();

    await expect(page.getByText("Your Strategy")).toBeVisible({ timeout: 5000 });
    // Without wallet connected, should show connect prompt
    await expect(
      page.getByText("Connect your wallet to deploy the agent."),
    ).toBeVisible();
  });

  test("shows error message on parse failure", async ({ page }) => {
    await page.route("**/api/parse-intent", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Venice API rate limited" }),
      }),
    );

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC");
    await page.getByRole("button", { name: /preview strategy/i }).click();

    await expect(page.getByText(/failed|error|rate limit/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test("Cmd+Enter triggers preview", async ({ page }) => {
    await page.route("**/api/parse-intent", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      });
    });

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("50/50 split");
    await textarea.press("Meta+Enter");

    await expect(
      page.getByText("Analyzing your strategy..."),
    ).toBeVisible({ timeout: 2000 });
  });

  test("Ctrl+Enter triggers preview (Windows/Linux)", async ({ page }) => {
    await page.route("**/api/parse-intent", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      });
    });

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("50/50 split");
    await textarea.press("Control+Enter");

    await expect(
      page.getByText("Analyzing your strategy..."),
    ).toBeVisible({ timeout: 2000 });
  });

  test("Edit button returns to input step", async ({ page }) => {
    await page.route("**/api/parse-intent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      }),
    );

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC");
    await page.getByRole("button", { name: /preview strategy/i }).click();
    await expect(page.getByText("Your Strategy")).toBeVisible({ timeout: 5000 });

    // Click Edit to go back
    await page.getByRole("button", { name: /edit/i }).click();
    await expect(page.getByRole("button", { name: /preview strategy/i })).toBeVisible();
  });

  test("shows permission details card after preview", async ({ page }) => {
    await page.route("**/api/parse-intent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      }),
    );

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC, $200/day, 7 days");
    await page.getByRole("button", { name: /preview strategy/i }).click();

    await expect(page.getByText("Permission Details")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("ERC-7715 permission scope")).toBeVisible();

    // Permission types
    await expect(page.getByText("native-token-periodic")).toBeVisible();
    await expect(page.getByText("erc20-token-periodic")).toBeVisible();

    // Agent address (truncated)
    await expect(page.getByText(/0xf130...c927/i)).toBeVisible();

    // MetaMask sponsor badge
    await expect(page.getByText("Enforced by MetaMask Delegation").first()).toBeVisible();
  });

  test("sponsor badges shown after preview", async ({ page }) => {
    await page.route("**/api/parse-intent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      }),
    );

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC");
    await page.getByRole("button", { name: /preview strategy/i }).click();

    await expect(page.getByText("Powered by Venice.ai")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Enforced by MetaMask Delegation").first()).toBeVisible();
  });
});
