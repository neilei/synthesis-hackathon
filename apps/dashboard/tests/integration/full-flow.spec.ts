/**
 * Integration test: full parse-intent flow against a live agent server.
 * Run: INTEGRATION=1 pnpm --filter @maw/dashboard test:e2e --project integration
 *
 * @module @maw/dashboard/tests/integration/full-flow.spec
 */
import { test, expect } from "@playwright/test";

test.describe("Full Stack Integration", () => {
  test("dashboard loads and shows configure screen", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Maw/);
    await expect(
      page.getByRole("tab", { name: /configure/i }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(/60\/40/)).toBeVisible();
  });

  test("parse-intent API returns valid parsed intent and audit", async ({
    request,
  }) => {
    test.setTimeout(120_000);

    const response = await request.post("/api/parse-intent", {
      data: { intent: "60/40 ETH/USDC, $200/day, 7 days" },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("parsed");
    expect(data).toHaveProperty("audit");
    expect(data.parsed).toHaveProperty("targetAllocation");
    expect(data.parsed).toHaveProperty("dailyBudgetUsd");
    expect(data.parsed).toHaveProperty("timeWindowDays");
    expect(data.parsed).toHaveProperty("maxSlippage");
    expect(data.parsed).toHaveProperty("driftThreshold");
    expect(data.parsed).toHaveProperty("maxTradesPerDay");
    expect(typeof data.parsed.dailyBudgetUsd).toBe("number");
    expect(Array.isArray(data.audit.allows)).toBe(true);
    expect(Array.isArray(data.audit.prevents)).toBe(true);
  });

  test("parse-intent API returns 400 for missing intent", async ({
    request,
  }) => {
    const response = await request.post("/api/parse-intent", {
      data: {},
    });
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty("error");
  });

  test("auth nonce API returns nonce for wallet", async ({ request }) => {
    const response = await request.get(
      "/api/auth/nonce?wallet=0xf13021F02E23a8113C1bD826575a1682F6Fac927",
    );
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(typeof data.nonce).toBe("string");
    expect(data.nonce.length).toBeGreaterThan(0);
  });

  test("intents API returns 401 without auth token", async ({ request }) => {
    const response = await request.get("/api/intents?wallet=0x1234");
    expect(response.status()).toBe(401);
  });
});
