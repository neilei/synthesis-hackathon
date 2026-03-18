/**
 * Cycle execution and activity feed integration tests. Verifies the agent
 * worker runs real cycles and the dashboard renders them correctly.
 *
 * These tests are slow (~2 min) due to 20s cycle intervals.
 *
 * Run: INTEGRATION=1 npx playwright test --project integration cycle-feed
 *
 * @module @veil/dashboard/tests/integration/cycle-feed.spec
 */
import { test, expect, gotoAuthenticated } from "../fixtures/auth";

test.setTimeout(120_000);

test.describe.serial("Cycle Execution and Activity Feed", () => {
  let intentId: string;

  test("create intent and wait for initialization", async ({
    page,
    auth,
    request,
    baseURL,
  }) => {
    const res = await request.post(`${baseURL}/api/intents`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        intentText: "Cycle test: 60/40 ETH/USDC, $100/day, 7 days",
        parsedIntent: {
          targetAllocation: { ETH: 0.6, USDC: 0.4 },
          dailyBudgetUsd: 100,
          timeWindowDays: 7,
          maxTradesPerDay: 5,
          maxSlippage: 0.005,
          driftThreshold: 0.05,
        },
        signedDelegation: "0xdeadbeef_cycle_test",
        delegatorSmartAccount: "0x0000000000000000000000000000000000CYC001",
      },
    });
    expect(res.status()).toBe(201);
    const data = await res.json();
    intentId = data.intent.id;

    // Wait for the worker to produce at least a worker_start log
    await new Promise((r) => setTimeout(r, 3000));

    await gotoAuthenticated(page, `/?intent=${intentId}`, auth);

    // Initialization group should appear (or at least some feed content).
    // cycle-group.tsx renders "Initialization" as the header text for
    // the init group (cycle === null).
    await expect(
      page.getByText("Initialization"),
    ).toBeVisible({ timeout: 20000 });
  });

  test("initialization group contains Worker Start entry", async ({
    page,
    auth,
  }) => {
    await gotoAuthenticated(page, `/?intent=${intentId}`, auth);

    // The init group is the newest group and defaultExpanded === true
    // (activity-feed.tsx reverses groups so init is last, but the first
    // in the reversed array gets defaultExpanded). If collapsed, expand it.
    const initGroup = page.getByText("Initialization");
    await expect(initGroup).toBeVisible({ timeout: 20000 });

    // Check aria-expanded; click to expand if needed
    const initButton = page.getByRole("button", { name: /Initialization/ });
    const isExpanded = await initButton.getAttribute("aria-expanded");
    if (isExpanded !== "true") {
      await initButton.click();
    }

    // feed-entry.tsx maps worker_start -> "Worker Start"
    await expect(
      page.getByText("Worker Start").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("cycle group appears after waiting for first cycle", async ({
    page,
    auth,
  }) => {
    // Wait for at least one full cycle (20s interval + processing time)
    await new Promise((r) => setTimeout(r, 25000));

    await gotoAuthenticated(page, `/?intent=${intentId}`, auth);

    // cycle-group.tsx renders "Cycle {group.cycle}" — should have "Cycle 1"
    await expect(page.getByText("Cycle 1")).toBeVisible({ timeout: 30000 });
  });

  test("cycle group header shows step count", async ({
    page,
    auth,
  }) => {
    await gotoAuthenticated(page, `/?intent=${intentId}`, auth);

    // Wait for Cycle 1 to be visible
    await expect(page.getByText("Cycle 1")).toBeVisible({ timeout: 30000 });

    // cycle-group.tsx renders "{successCount}/{total} steps" in the header
    // for both init and cycle groups
    await expect(page.getByText(/\d+\/\d+ steps/)).toBeVisible();
  });

  test("expanded cycle group shows feed entries", async ({
    page,
    auth,
  }) => {
    await gotoAuthenticated(page, `/?intent=${intentId}`, auth);

    // Expand Cycle 1 if not already expanded
    const cycle1Button = page.getByRole("button", { name: /Cycle 1/ });
    await expect(cycle1Button).toBeVisible({ timeout: 30000 });
    const isExpanded = await cycle1Button.getAttribute("aria-expanded");
    if (isExpanded !== "true") {
      await cycle1Button.click();
    }

    // A cycle should contain at least a "Price" entry (price_fetch is
    // always the first step in a cycle). feed-entry.tsx maps
    // price_fetch -> "Price".
    await expect(
      page.getByText("Price").first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("cycle group shows Decision entry", async ({
    page,
    auth,
  }) => {
    await gotoAuthenticated(page, `/?intent=${intentId}`, auth);

    // Expand Cycle 1
    const cycle1Button = page.getByRole("button", { name: /Cycle 1/ });
    await expect(cycle1Button).toBeVisible({ timeout: 30000 });
    const isExpanded = await cycle1Button.getAttribute("aria-expanded");
    if (isExpanded !== "true") {
      await cycle1Button.click();
    }

    // feed-entry.tsx maps rebalance_decision -> "Decision"
    // and cycle_complete -> "Cycle". A completed cycle always
    // includes at least one of these.
    const hasDecision = await page
      .getByText("Decision")
      .first()
      .isVisible()
      .catch(() => false);
    const hasCycle = await page
      .getByText("Cycle", { exact: true })
      .first()
      .isVisible()
      .catch(() => false);

    // At least one should be true — cycle entries always include
    // either a decision or a cycle-complete entry.
    expect(hasDecision || hasCycle).toBe(true);
  });

  test("SSE delivers new cycle entries without page refresh", async ({
    page,
    auth,
  }) => {
    await gotoAuthenticated(page, `/?intent=${intentId}`, auth);

    // Wait for the activity feed to load
    await expect(page.getByText("Activity Feed")).toBeVisible({
      timeout: 10000,
    });

    // Count current cycle group buttons (match "Cycle N" pattern)
    const initialCycleCount = await page
      .getByRole("button", { name: /^Cycle \d+/ })
      .count();

    // Wait for next cycle (20s interval + processing buffer)
    await new Promise((r) => setTimeout(r, 25000));

    // New cycle should appear without a page refresh (SSE push).
    // The activity feed component subscribes to SSE via useIntentFeed.
    const newCycleCount = await page
      .getByRole("button", { name: /^Cycle \d+/ })
      .count();
    expect(newCycleCount).toBeGreaterThan(initialCycleCount);
  });

  test("Next Cycle stat card is visible for active intent", async ({
    page,
    auth,
  }) => {
    await gotoAuthenticated(page, `/?intent=${intentId}`, auth);

    // monitor.tsx renders a card with heading "Next Cycle" and a
    // CycleCountdown inside showing "{secondsLeft}s".
    await expect(page.getByText("Next Cycle")).toBeVisible({ timeout: 10000 });

    // The countdown renders something like "18s" — a number followed by "s"
    await expect(page.getByText(/^\d+s$/)).toBeVisible({ timeout: 10000 });
  });

  test("cleanup: cancel the intent", async ({ request, auth, baseURL }) => {
    await request.delete(`${baseURL}/api/intents/${intentId}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
  });
});
