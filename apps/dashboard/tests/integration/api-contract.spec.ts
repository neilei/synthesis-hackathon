/**
 * Integration tests: verify dashboard type expectations match agent server responses.
 * Run: INTEGRATION=1 pnpm --filter @veil/dashboard test:e2e --project integration
 *
 * @module @veil/dashboard/tests/integration/api-contract.spec
 */
import { test, expect } from "@playwright/test";

test.describe("API Contract: /api/state", () => {
  test("response conforms to AgentStateResponse type", async ({ request }) => {
    const response = await request.get("/api/state");
    expect(response.status()).toBe(200);

    const data = await response.json();

    // Required fields with correct types
    expect(typeof data.cycle).toBe("number");
    expect(typeof data.running).toBe("boolean");
    expect(typeof data.ethPrice).toBe("number");
    expect(typeof data.drift).toBe("number");
    expect(typeof data.trades).toBe("number");
    expect(typeof data.totalSpent).toBe("number");
    expect(typeof data.budgetTier).toBe("string");
    expect(typeof data.totalValue).toBe("number");

    // Objects
    expect(typeof data.allocation).toBe("object");
    expect(data.allocation).not.toBeNull();
    expect(typeof data.target).toBe("object");
    expect(data.target).not.toBeNull();

    // Arrays
    expect(Array.isArray(data.feed)).toBe(true);
    expect(Array.isArray(data.transactions)).toBe(true);

    // Nullable
    expect(
      data.audit === null || typeof data.audit === "object",
    ).toBe(true);

    // If allocation has entries, values should be numbers between 0 and 1
    for (const [key, value] of Object.entries(data.allocation)) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("number");
      expect(Number(value)).toBeGreaterThanOrEqual(0);
      expect(Number(value)).toBeLessThanOrEqual(1);
    }

    // Same for target
    for (const [key, value] of Object.entries(data.target)) {
      expect(typeof key).toBe("string");
      expect(typeof value).toBe("number");
    }
  });

  test("transactions conform to SwapRecord type", async ({ request }) => {
    const response = await request.get("/api/state");
    const data = await response.json();

    for (const tx of data.transactions) {
      expect(typeof tx.txHash).toBe("string");
      expect(tx.txHash).toMatch(/^0x[0-9a-f]+$/i);
      expect(typeof tx.sellToken).toBe("string");
      expect(typeof tx.buyToken).toBe("string");
      expect(typeof tx.sellAmount).toBe("string");
      expect(typeof tx.status).toBe("string");
      expect(typeof tx.timestamp).toBe("string");
      // Timestamp should be ISO format
      expect(new Date(tx.timestamp).toISOString()).toBeTruthy();
    }
  });

  test("audit conforms to AuditReport type when present", async ({
    request,
  }) => {
    const response = await request.get("/api/state");
    const data = await response.json();

    if (data.audit !== null) {
      expect(Array.isArray(data.audit.allows)).toBe(true);
      expect(Array.isArray(data.audit.prevents)).toBe(true);
      expect(typeof data.audit.worstCase).toBe("string");
      expect(Array.isArray(data.audit.warnings)).toBe(true);

      for (const item of data.audit.allows) {
        expect(typeof item).toBe("string");
      }
      for (const item of data.audit.prevents) {
        expect(typeof item).toBe("string");
      }
    }
  });

  test("feed entries conform to AgentLogEntry type", async ({ request }) => {
    const response = await request.get("/api/state");
    const data = await response.json();

    for (const entry of data.feed) {
      expect(typeof entry.timestamp).toBe("string");
      expect(typeof entry.sequence).toBe("number");
      expect(typeof entry.action).toBe("string");
    }
  });
});

test.describe("API Contract: /api/deploy", () => {
  test("400 on missing intent", async ({ request }) => {
    const response = await request.post("/api/deploy", {
      data: {},
    });
    // Agent server returns 400 for missing intent
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty("error");
  });

  test("400 on empty intent", async ({ request }) => {
    const response = await request.post("/api/deploy", {
      data: { intent: "" },
    });
    expect(response.status()).toBe(400);
  });
});
