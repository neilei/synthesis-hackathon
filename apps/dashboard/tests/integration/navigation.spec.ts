/**
 * Browser navigation integration tests — tab switching, URL persistence,
 * browser back button.
 *
 * Run: INTEGRATION=1 npx playwright test --project integration navigation
 *
 * @module @veil/dashboard/tests/integration/navigation.spec
 */
import { test, expect, gotoAuthenticated } from "../fixtures/auth";

test.describe.serial("Navigation and Persistence", () => {
  test("page loads on Configure tab by default", async ({ page, auth }) => {
    await gotoAuthenticated(page, "/", auth);
    const configureTab = page.getByRole("tab", { name: /configure/i });
    await expect(configureTab).toHaveAttribute("aria-selected", "true");
  });

  test("clicking Monitor tab switches and shows intent list or empty state", async ({
    page,
    auth,
  }) => {
    await gotoAuthenticated(page, "/", auth);
    await page.getByRole("tab", { name: /monitor/i }).click();
    await expect(
      page.getByText(/no agents running|your agents/i),
    ).toBeVisible({ timeout: 10000 });
  });

  test("?tab=monitor opens monitor tab on refresh", async ({ page, auth }) => {
    await gotoAuthenticated(page, "/?tab=monitor", auth);
    const monitorTab = page.getByRole("tab", { name: /monitor/i });
    await expect(monitorTab).toHaveAttribute("aria-selected", "true");
  });

  test("?intent=X opens monitor tab with intent detail", async ({
    page,
    auth,
    request,
    baseURL,
  }) => {
    // Create an intent first via API
    const createRes = await request.post(`${baseURL}/api/intents`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        intentText: "Nav test: 60/40 ETH/USDC, $100/day, 7 days",
        parsedIntent: {
          targetAllocation: { ETH: 0.6, USDC: 0.4 },
          dailyBudgetUsd: 100,
          timeWindowDays: 7,
          maxTradesPerDay: 5,
          maxSlippage: 0.005,
          driftThreshold: 0.05,
        },
        signedDelegation: "0xdeadbeef_nav_test",
        delegatorSmartAccount: "0x0000000000000000000000000000000000NAV001",
      },
    });
    expect(createRes.status()).toBe(201);
    const { intent } = await createRes.json();

    // Navigate with intent param
    await gotoAuthenticated(page, `/?intent=${intent.id}`, auth);

    // Should show intent detail (back button visible)
    await expect(page.getByText(/back to intents/i)).toBeVisible({
      timeout: 10000,
    });

    // Clean up
    await request.delete(`${baseURL}/api/intents/${intent.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
  });

  test("browser back button returns to intent list from detail", async ({
    page,
    auth,
    request,
    baseURL,
  }) => {
    // Create intent
    const createRes = await request.post(`${baseURL}/api/intents`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        intentText: "Back button test: 50/50 ETH/USDC, $50/day, 3 days",
        parsedIntent: {
          targetAllocation: { ETH: 0.5, USDC: 0.5 },
          dailyBudgetUsd: 50,
          timeWindowDays: 3,
          maxTradesPerDay: 3,
          maxSlippage: 0.005,
          driftThreshold: 0.05,
        },
        signedDelegation: "0xdeadbeef_back_test",
        delegatorSmartAccount: "0x0000000000000000000000000000000000BAK001",
      },
    });
    const { intent } = await createRes.json();

    // Go to monitor, click into intent
    await gotoAuthenticated(page, "/?tab=monitor", auth);
    await page.getByText(intent.intentText).click();
    await expect(page.getByText(/back to intents/i)).toBeVisible({
      timeout: 10000,
    });

    // Press browser back
    await page.goBack();
    await expect(page.getByText(/your agents/i)).toBeVisible({
      timeout: 10000,
    });

    // Cleanup
    await request.delete(`${baseURL}/api/intents/${intent.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
  });
});
