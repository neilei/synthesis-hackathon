/**
 * Integration test: full deploy-to-monitor flow against a live agent server.
 * Run: INTEGRATION=1 pnpm --filter @veil/dashboard test:e2e --project integration
 *
 * @module @veil/dashboard/tests/integration/full-flow.spec
 */
import { test, expect } from "@playwright/test";

/**
 * Check whether the agent is already running (from a prior deploy).
 * If so, many tests can still verify state/monitor — they just skip the deploy step.
 */
async function isAgentRunning(
  request: import("@playwright/test").APIRequestContext,
): Promise<boolean> {
  const res = await request.get("/api/state");
  const data = await res.json();
  return data.running === true;
}

test.describe("Full Stack Integration", () => {
  test("dashboard loads and shows configure screen", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Veil/);
    await expect(
      page.getByRole("tab", { name: /configure/i }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(/60\/40/)).toBeVisible();
  });

  test("state API returns valid JSON structure", async ({ request }) => {
    const response = await request.get("/api/state");
    expect(response.status()).toBe(200);

    const data = await response.json();
    // Verify the shape matches AgentStateResponse
    expect(typeof data.cycle).toBe("number");
    expect(typeof data.running).toBe("boolean");
    expect(typeof data.totalValue).toBe("number");
    expect(typeof data.drift).toBe("number");
    expect(typeof data.trades).toBe("number");
    expect(typeof data.totalSpent).toBe("number");
    expect(typeof data.budgetTier).toBe("string");
    expect(typeof data.ethPrice).toBe("number");
    expect(typeof data.allocation).toBe("object");
    expect(typeof data.target).toBe("object");
    expect(Array.isArray(data.feed)).toBe(true);
    expect(Array.isArray(data.transactions)).toBe(true);
    expect(
      data.audit === null || typeof data.audit === "object",
    ).toBe(true);
  });

  test("deploy intent via Venice AI and verify audit screen", async ({
    page,
    request,
  }) => {
    // Skip if agent already running — can't deploy twice
    const running = await isAgentRunning(request);
    test.skip(running, "Agent already running — cannot deploy again");

    test.setTimeout(120_000);

    await page.goto("/");
    const textarea = page.getByPlaceholder(/60\/40/);
    await textarea.fill("60/40 ETH/USDC, $200/day, 7 days");
    await page.getByRole("button", { name: /compile & deploy/i }).click();

    // Wait for Venice to respond — audit screen should render
    await expect(page.getByText("Parsed Intent")).toBeVisible({
      timeout: 90_000,
    });

    // Verify real parsed values (Venice should extract these from the intent)
    await expect(page.getByText("Daily Budget")).toBeVisible();
    await expect(page.getByText("Time Window")).toBeVisible();

    // Allocation bar should show ETH and USDC
    await expect(page.getByText(/ETH \d+%/)).toBeVisible();
    await expect(page.getByText(/USDC \d+%/)).toBeVisible();
  });

  test("monitor screen shows real agent data when running", async ({
    page,
    request,
  }) => {
    const running = await isAgentRunning(request);
    test.skip(!running, "Agent not running — deploy first");

    test.setTimeout(60_000);

    await page.goto("/");

    // Click Monitor tab directly (should be enabled since agent is running)
    // The tabs are enabled after deploy data is available in page state.
    // Since the page loads fresh, we need to trigger a deploy or navigate via state.
    // Instead, let's use the API directly to verify monitor data.
    const stateRes = await request.get("/api/state");
    const state = await stateRes.json();

    expect(state.running).toBe(true);
    expect(state.target).toHaveProperty("ETH");
    expect(state.target).toHaveProperty("USDC");

    // If at least one cycle completed, we should have real balance data
    if (state.cycle > 0) {
      expect(state.ethPrice).toBeGreaterThan(0);
      expect(state.totalValue).toBeGreaterThan(0);
      expect(Object.keys(state.allocation).length).toBeGreaterThan(0);
    }
  });

  test("deploy API returns 409 when agent already running", async ({
    request,
  }) => {
    const running = await isAgentRunning(request);
    test.skip(!running, "Agent not running — nothing to conflict with");

    const response = await request.post("/api/deploy", {
      data: { intent: "80/20 ETH/USDC" },
    });

    expect(response.status()).toBe(409);
    const data = await response.json();
    expect(data.error).toContain("already running");
  });

  test("deploy API returns valid response when no agent running", async ({
    request,
  }) => {
    const running = await isAgentRunning(request);
    test.skip(running, "Agent already running — would get 409");

    test.setTimeout(120_000);

    const response = await request.post("/api/deploy", {
      data: { intent: "60/40 ETH/USDC, $200/day, 7 days" },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("parsed");
    expect(data.parsed).toHaveProperty("targetAllocation");
    expect(data.parsed).toHaveProperty("dailyBudgetUsd");
    expect(data.parsed).toHaveProperty("timeWindowDays");
    expect(data.parsed).toHaveProperty("maxSlippage");
    expect(data.parsed).toHaveProperty("driftThreshold");
    expect(data.parsed).toHaveProperty("maxTradesPerDay");
    expect(typeof data.parsed.dailyBudgetUsd).toBe("number");
  });

  test("state API shows cycle data after deploy", async ({ request }) => {
    const running = await isAgentRunning(request);
    test.skip(!running, "Agent not running — no cycles to check");

    test.setTimeout(60_000);

    // Poll until at least one cycle completes
    await expect(async () => {
      const response = await request.get("/api/state");
      const data = await response.json();
      expect(data.cycle).toBeGreaterThan(0);
      expect(data.target).toHaveProperty("ETH");
    }).toPass({ timeout: 60_000, intervals: [3000] });
  });
});
