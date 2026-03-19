import { test, expect } from "@playwright/test";

test.describe("Public intent visibility", () => {
  test("shows active agents list without wallet connection", async ({ page, baseURL }) => {
    await page.goto(baseURL ?? "/");

    // Navigate to Monitor tab
    const monitorTab = page.getByRole("tab", { name: /monitor/i });
    await monitorTab.click();

    // Should see the "Active Agents" heading — not a "connect wallet" gate
    await expect(
      page.getByText(/active agents/i).first()
    ).toBeVisible({ timeout: 15000 });

    // Should NOT see "Connect your wallet" as a blocking heading
    const connectHeading = page.getByRole("heading", { name: /connect your wallet/i });
    await expect(connectHeading).not.toBeVisible();
  });

  test("shows 'Show stopped' toggle", async ({ page, baseURL }) => {
    await page.goto(baseURL ?? "/");
    const monitorTab = page.getByRole("tab", { name: /monitor/i });
    await monitorTab.click();

    await expect(
      page.getByLabel(/show stopped/i)
    ).toBeVisible({ timeout: 15000 });
  });

  test("can navigate to public intent detail and sees no owner controls", async ({ page, baseURL }) => {
    await page.goto(baseURL ?? "/");
    const monitorTab = page.getByRole("tab", { name: /monitor/i });
    await monitorTab.click();

    // Wait for intent cards to appear
    await page.waitForTimeout(3000);

    const intentCards = page.locator("button").filter({ hasText: /cycle/i });
    const count = await intentCards.count();

    if (count > 0) {
      await intentCards.first().click();

      // Should see back button and activity feed
      await expect(
        page.getByText(/back to agents/i)
      ).toBeVisible({ timeout: 10000 });

      await expect(
        page.getByText(/activity feed/i)
      ).toBeVisible({ timeout: 10000 });

      // Should NOT see owner-only controls
      await expect(
        page.getByRole("button", { name: /download agent_log/i })
      ).not.toBeVisible();

      await expect(
        page.getByRole("button", { name: /stop agent/i })
      ).not.toBeVisible();

      // Wait for feed entries to load, then check for privacy indicators
      // (privacy notices appear if the agent has made Venice AI decisions)
      await page.waitForTimeout(5000);
      const privacyNotices = page.getByText(/end-to-end encrypted/i);
      const privacyCount = await privacyNotices.count();
      if (privacyCount > 0) {
        await expect(privacyNotices.first()).toBeVisible();
      }
    }
  });
});
