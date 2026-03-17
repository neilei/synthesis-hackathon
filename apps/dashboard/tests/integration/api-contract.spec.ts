/**
 * Integration tests: verify dashboard type expectations match agent server responses.
 * Run: INTEGRATION=1 pnpm --filter @veil/dashboard test:e2e --project integration
 *
 * @module @veil/dashboard/tests/integration/api-contract.spec
 */
import { test, expect } from "@playwright/test";

test.describe("API Contract: /api/parse-intent", () => {
  test("400 on missing intent text", async ({ request }) => {
    const response = await request.post("/api/parse-intent", {
      data: {},
    });
    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty("error");
  });
});

test.describe("API Contract: /api/auth/nonce", () => {
  test("returns nonce for valid wallet", async ({ request }) => {
    const response = await request.get(
      "/api/auth/nonce?wallet=0xf13021F02E23a8113C1bD826575a1682F6Fac927",
    );
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(typeof data.nonce).toBe("string");
    expect(data.nonce.length).toBeGreaterThan(0);
  });

  test("400 on missing wallet", async ({ request }) => {
    const response = await request.get("/api/auth/nonce");
    expect(response.status()).toBe(400);
  });
});

test.describe("API Contract: /api/intents", () => {
  test("401 without auth token", async ({ request }) => {
    const response = await request.get("/api/intents?wallet=0x1234");
    expect(response.status()).toBe(401);
  });
});
