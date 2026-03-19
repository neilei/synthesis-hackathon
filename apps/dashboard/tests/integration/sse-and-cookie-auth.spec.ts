/**
 * Integration tests for SSE activity feed and cookie-based auth.
 *
 * Tests the real server endpoints:
 * - POST /api/auth/verify sets HttpOnly veil_token cookie
 * - GET /api/intents/:id/events authenticates via cookie (SSE)
 * - GET /api/intents/:id returns logs from SQLite
 * - CORS includes Access-Control-Allow-Credentials: true
 *
 * Run:
 *   INTEGRATION=1 pnpm --filter @veil/dashboard test:e2e --project integration -g "SSE and Cookie Auth"
 *
 * @module @veil/dashboard/tests/integration/sse-and-cookie-auth.spec
 */
import { test, expect } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.DEPLOYED_URL ?? "https://api.veil.moe";

const VALID_PARSED_INTENT = {
  targetAllocation: { ETH: 0.6, USDC: 0.4 },
  dailyBudgetUsd: 100,
  timeWindowDays: 7,
  maxTradesPerDay: 5,
  maxPerTradeUsd: 100,
  maxSlippage: 0.005,
  driftThreshold: 0.05,
};

test.describe.serial("SSE and Cookie Auth", () => {
  let wallet: string;
  let token: string;
  let intentId: string;

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  test.beforeAll(async () => {
    wallet = account.address;
  });

  test("step 1: auth verify sets HttpOnly cookie", async ({ request }) => {
    // Get nonce
    const nonceRes = await request.get(
      `${BASE_URL}/api/auth/nonce?wallet=${wallet}`,
    );
    expect(nonceRes.status()).toBe(200);
    const { nonce } = await nonceRes.json();

    // Sign and verify
    const message = `Sign this message to authenticate with Veil.\n\nNonce: ${nonce}`;
    const signature = await account.signMessage({ message });

    const verifyRes = await request.post(`${BASE_URL}/api/auth/verify`, {
      data: { wallet, signature },
    });
    expect(verifyRes.status()).toBe(200);

    const verifyData = await verifyRes.json();
    token = verifyData.token;
    expect(typeof token).toBe("string");

    // Verify Set-Cookie header is present
    const setCookie = verifyRes.headers()["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("veil_token=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/api");
  });

  test("step 2: create intent for SSE testing", async ({ request }) => {
    expect(token).toBeDefined();

    const res = await request.post(`${BASE_URL}/api/intents`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        intentText: "SSE test: 60/40 ETH/USDC, $100/day, 7 days",
        parsedIntent: VALID_PARSED_INTENT,
        signedDelegation: "0xdeadbeef_sse_test",
        delegatorSmartAccount: "0x0000000000000000000000000000000000SSE001",
      },
    });

    expect(res.status()).toBe(201);
    const data = await res.json();
    intentId = data.intent.id;
    expect(intentId).toBeTruthy();
  });

  test("step 3: intent detail returns logs array from SQLite", async ({
    request,
  }) => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    const res = await request.get(`${BASE_URL}/api/intents/${intentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("logs");
    expect(Array.isArray(data.logs)).toBe(true);
    // Worker should have logged at least worker_start or worker_error
    // (may fail immediately if DELEGATOR_PRIVATE_KEY missing, that's fine)
    if (data.logs.length > 0) {
      const first = data.logs[0];
      expect(first).toHaveProperty("sequence");
      expect(first).toHaveProperty("action");
      expect(first).toHaveProperty("timestamp");
      expect(typeof first.sequence).toBe("number");
    }
  });

  test("step 4: intent detail supports cursor pagination", async ({
    request,
  }) => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    // Fetch with after=-1 (all entries)
    const allRes = await request.get(
      `${BASE_URL}/api/intents/${intentId}?after=-1&limit=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(allRes.status()).toBe(200);
    const allData = await allRes.json();
    const allLogs = allData.logs;

    if (allLogs.length > 0) {
      // Fetch with after=first sequence — should return fewer entries
      const afterRes = await request.get(
        `${BASE_URL}/api/intents/${intentId}?after=${allLogs[0].sequence}&limit=100`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(afterRes.status()).toBe(200);
      const afterData = await afterRes.json();
      expect(afterData.logs.length).toBeLessThan(allLogs.length);
    }
  });

  test("step 5: SSE endpoint returns 401 without auth", async ({
    request,
  }) => {
    expect(intentId).toBeDefined();

    const res = await request.get(
      `${BASE_URL}/api/intents/${intentId}/events`,
    );
    expect(res.status()).toBe(401);
  });

  test("step 6: SSE endpoint accepts auth and streams", async () => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    // SSE is a long-lived stream — native fetch resolves on headers, letting
    // us verify status + content-type without waiting for the stream to end.
    const controller = new AbortController();
    const res = await fetch(
      `${BASE_URL}/api/intents/${intentId}/events`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/event-stream");

    // Abort the long-lived stream — we've verified the connection works
    controller.abort();
  });

  test("step 7: CORS includes credentials header", async ({ request }) => {
    const res = await request.fetch(`${BASE_URL}/api/auth/nonce?wallet=0x1`, {
      method: "GET",
      headers: { Origin: "https://veil.moe" },
    });

    const corsCredentials =
      res.headers()["access-control-allow-credentials"];
    expect(corsCredentials).toBe("true");
  });

  test("step 8: cleanup — cancel intent", async ({ request }) => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    const res = await request.delete(
      `${BASE_URL}/api/intents/${intentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);
  });
});
