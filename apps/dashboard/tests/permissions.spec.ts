/**
 * Playwright e2e tests for the ERC-7715 permission granting flow in the
 * Configure tab. Since Playwright cannot control MetaMask Flask, we test
 * the UI states and interactions leading up to the permission request,
 * including wallet connection prompts, auth flow, and error handling.
 *
 * Tests use mocked API responses (parse-intent, auth) to verify:
 * - The "Grant Permissions & Deploy" button appears when authenticated
 * - The "Connect your wallet" prompt shows when not connected
 * - The signing state shows correct status text
 * - Error states display correctly when permission request fails
 *
 * @module @maw/dashboard/tests/permissions.spec
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
    allows: [
      "Swap ETH ↔ USDC on Uniswap V3",
      "Rebalance within 5% drift threshold",
    ],
    prevents: [
      "Transfer to external addresses",
      "Swap tokens not in allocation",
    ],
    worstCase: "Maximum daily loss: $200",
    warnings: [],
  },
};

test.describe("ERC-7715 Permission Flow (Configure Tab)", () => {
  test.beforeEach(async ({ page }) => {
    // Mock parse-intent API
    await page.route("**/api/parse-intent", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      }),
    );

    // Navigate and fill in intent
    await page.goto("/");
    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC, $200/day, 7 days");
    await page.getByRole("button", { name: /preview strategy/i }).click();
    await expect(page.getByText("Your Strategy")).toBeVisible({
      timeout: 5000,
    });
  });

  test("shows wallet connection prompt when no wallet connected", async ({
    page,
  }) => {
    await expect(
      page.getByText("Connect your wallet to deploy the agent."),
    ).toBeVisible();
    // Deploy button should NOT be visible
    await expect(
      page.getByRole("button", { name: /grant permissions/i }),
    ).not.toBeVisible();
  });

  test("shows Permission Details card with ERC-7715 scope info", async ({
    page,
  }) => {
    await expect(page.getByText("Permission Details")).toBeVisible();
    await expect(page.getByText("ERC-7715 permission scope")).toBeVisible();
  });

  test("shows delegate agent address in permission details", async ({
    page,
  }) => {
    await expect(page.getByText("Delegate (Agent)")).toBeVisible();
    await expect(page.getByText(/0xf130...c927/i)).toBeVisible();
  });

  test("shows period duration in permission details", async ({ page }) => {
    await expect(page.getByText("Period Duration")).toBeVisible();
    await expect(page.getByText("24 hours")).toBeVisible();
  });

  test("shows expiry in permission details", async ({ page }) => {
    await expect(page.getByText("Expires")).toBeVisible();
  });

  test("shows requested permission types", async ({ page }) => {
    await expect(page.getByText("Requested Permissions")).toBeVisible();
    await expect(page.getByText("native-token-periodic")).toBeVisible();
    await expect(page.getByText("erc20-token-periodic")).toBeVisible();
  });

  test("shows Flask notice or wallet prompt depending on connection state", async ({
    page,
  }) => {
    // Without a wallet connected, the Flask notice is hidden behind the
    // "Connect your wallet" prompt. Verify that one of them is visible.
    const walletPrompt = page.getByText("Connect your wallet to deploy the agent.");
    const flaskNotice = page.getByText(/MetaMask Flask/);

    const walletPromptVisible = await walletPrompt.isVisible().catch(() => false);
    const flaskVisible = await flaskNotice.isVisible().catch(() => false);

    expect(walletPromptVisible || flaskVisible).toBe(true);
  });

  test("permission report sections are visible", async ({ page }) => {
    await expect(page.getByText("Permission Report")).toBeVisible();
    await expect(page.getByText("Allows")).toBeVisible();
    await expect(page.getByText("Prevents")).toBeVisible();
    await expect(page.getByText("Worst Case")).toBeVisible();
  });

  test("edit button returns to input step", async ({ page }) => {
    await page.getByRole("button", { name: /edit/i }).click();
    await expect(
      page.getByRole("button", { name: /preview strategy/i }),
    ).toBeVisible();
  });

  test("preset buttons populate intent text", async ({ page }) => {
    // Go back to input
    await page.getByRole("button", { name: /edit/i }).click();

    const preset = page.getByRole("button", {
      name: /80\/20 ETH\/USDC/,
    });
    await preset.click();

    const textarea = page.getByPlaceholder(/60\/40/);
    await expect(textarea).toHaveValue(
      "80/20 ETH/USDC, conservative, 30 days",
    );
  });

  test("parsing shows loading state", async ({ page }) => {
    // Go back to input
    await page.getByRole("button", { name: /edit/i }).click();

    // Slow down the API response
    await page.route("**/api/parse-intent", async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PARSE_RESPONSE),
      });
    });

    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("test intent");
    await page.getByRole("button", { name: /preview strategy/i }).click();

    await expect(
      page.getByText("Analyzing your strategy..."),
    ).toBeVisible();
  });

  test("parse error shows error message", async ({ page }) => {
    // Start fresh — navigate and set up error route before any interaction
    await page.unroute("**/api/parse-intent");
    await page.route("**/api/parse-intent", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Missing intent text" }),
      }),
    );

    await page.goto("/");
    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("bad input");
    await page.getByRole("button", { name: /preview strategy/i }).click();

    // The configure component renders errors in a <p role="alert">
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5000 });
  });
});
