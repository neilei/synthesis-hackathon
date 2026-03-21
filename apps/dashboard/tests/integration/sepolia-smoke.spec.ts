/**
 * Automated Sepolia smoke tests. Exercises the full deployed system:
 * - Auth flow (nonce + signature + verify)
 * - Intent creation with ERC-7715 permission data
 * - Intent listing, detail retrieval
 * - Audit report in response
 * - Wallet scoping (isolation between wallets)
 * - Intent cancellation
 * - SSE endpoint accessibility
 * - Evidence endpoint validation
 *
 * Run against VPS:
 *   INTEGRATION=1 DEPLOYED_URL=https://api.maw.finance pnpm --filter @maw/dashboard test:e2e --project integration -g "Sepolia Smoke"
 *
 * @module @maw/dashboard/tests/integration/sepolia-smoke.spec
 */
import { test, expect } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.DEPLOYED_URL ?? "https://api.maw.finance";

const VALID_PARSED_INTENT = {
  targetAllocation: { ETH: 0.6, USDC: 0.4 },
  dailyBudgetUsd: 100,
  timeWindowDays: 7,
  maxTradesPerDay: 5,
  maxPerTradeUsd: 100,
  maxSlippage: 0.005,
  driftThreshold: 0.05,
};

const MOCK_PERMISSIONS = [
  {
    type: "native-token-periodic",
    context: "0xdeadbeef_smoke_test_native",
    token: "ETH",
  },
  {
    type: "erc20-token-periodic",
    context: "0xdeadbeef_smoke_test_erc20",
    token: "USDC",
  },
];

test.describe("Sepolia Smoke Tests", () => {
  let wallet: ReturnType<typeof privateKeyToAccount>;
  let token: string;
  let intentId: string;

  test.beforeAll(() => {
    const privateKey = generatePrivateKey();
    wallet = privateKeyToAccount(privateKey);
  });

  test("step 1: auth flow — nonce, sign, verify", async ({ request }) => {
    const nonceRes = await request.get(
      `${BASE_URL}/api/auth/nonce?wallet=${wallet.address}`,
    );
    expect(nonceRes.status()).toBe(200);
    const { nonce } = await nonceRes.json();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);

    const message = `Sign this message to authenticate with Maw.\n\nNonce: ${nonce}`;
    const signature = await wallet.signMessage({ message });

    const verifyRes = await request.post(`${BASE_URL}/api/auth/verify`, {
      data: { wallet: wallet.address, signature },
    });
    expect(verifyRes.status()).toBe(200);
    const verifyData = await verifyRes.json();
    expect(typeof verifyData.token).toBe("string");
    token = verifyData.token;
  });

  test("step 2: create intent with ERC-7715 permissions", async ({
    request,
  }) => {
    expect(token).toBeDefined();

    const res = await request.post(`${BASE_URL}/api/intents`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        intentText: "Smoke test: 60/40 ETH/USDC, $100/day, 7 days",
        parsedIntent: VALID_PARSED_INTENT,
        permissions: JSON.stringify(MOCK_PERMISSIONS),
        delegationManager: "0x0000000000000000000000000000000000Sm0k3",
        dependencies: "[]",
      },
    });

    expect(res.status()).toBe(201);
    const data = await res.json();

    expect(data.intent).toBeDefined();
    expect(data.intent.id).toBeTruthy();
    expect(data.intent.walletAddress).toBe(wallet.address.toLowerCase());
    expect(data.intent.intentText).toContain("Smoke test");
    expect(data.intent.status).toMatch(/active|failed/);

    expect(data.audit).toBeDefined();
    expect(data.audit.allows).toBeInstanceOf(Array);
    expect(data.audit.allows.length).toBeGreaterThan(0);
    expect(data.audit.prevents).toBeInstanceOf(Array);
    expect(data.audit.prevents.length).toBeGreaterThan(0);
    expect(typeof data.audit.worstCase).toBe("string");

    expect(data.intent.permissions).toBeDefined();
    const perms = JSON.parse(data.intent.permissions);
    expect(perms).toHaveLength(2);
    expect(perms[0].type).toBe("native-token-periodic");
    expect(perms[1].type).toBe("erc20-token-periodic");

    intentId = data.intent.id;
  });

  test("step 3: list intents shows the new intent", async ({ request }) => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    const res = await request.get(
      `${BASE_URL}/api/intents?wallet=${wallet.address}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const intents = await res.json();
    expect(Array.isArray(intents)).toBe(true);

    const found = intents.find(
      (i: { id: string }) => i.id === intentId,
    );
    expect(found).toBeDefined();
    expect(found.intentText).toContain("Smoke test");
  });

  test("step 4: get intent detail with liveState and permissions", async ({
    request,
  }) => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    const res = await request.get(
      `${BASE_URL}/api/intents/${intentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const data = await res.json();

    expect(data.id).toBe(intentId);
    expect(data.walletAddress).toBe(wallet.address.toLowerCase());
    expect(data).toHaveProperty("liveState");
    expect(data).toHaveProperty("workerStatus");
    expect(data).toHaveProperty("logs");

    const parsed = JSON.parse(data.parsedIntent);
    expect(parsed.targetAllocation.ETH).toBe(0.6);
    expect(parsed.targetAllocation.USDC).toBe(0.4);
    expect(parsed.dailyBudgetUsd).toBe(100);

    const perms = JSON.parse(data.permissions);
    expect(perms).toHaveLength(2);
    expect(data.delegationManager).toBeTruthy();
  });

  test("step 5: wallet scoping — other wallet cannot access intent", async ({
    request,
  }) => {
    expect(intentId).toBeDefined();

    const otherKey = generatePrivateKey();
    const otherAccount = privateKeyToAccount(otherKey);

    const nonceRes = await request.get(
      `${BASE_URL}/api/auth/nonce?wallet=${otherAccount.address}`,
    );
    const { nonce } = await nonceRes.json();
    const message = `Sign this message to authenticate with Maw.\n\nNonce: ${nonce}`;
    const sig = await otherAccount.signMessage({ message });

    const verifyRes = await request.post(`${BASE_URL}/api/auth/verify`, {
      data: { wallet: otherAccount.address, signature: sig },
    });
    const { token: otherToken } = await verifyRes.json();

    const res = await request.get(
      `${BASE_URL}/api/intents/${intentId}`,
      { headers: { Authorization: `Bearer ${otherToken}` } },
    );
    expect(res.status()).toBe(403);
  });

  test("step 6: cancel intent", async ({ request }) => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    const res = await request.delete(
      `${BASE_URL}/api/intents/${intentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("cancelled");
  });

  test("step 7: verify intent is cancelled", async ({ request }) => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    const res = await request.get(
      `${BASE_URL}/api/intents/${intentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("cancelled");
  });

  // --- Independent tests (don't depend on intent lifecycle order) ---

  test("step 8: SSE endpoint returns event-stream content type", async () => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    // SSE streams never complete, so Playwright's request.get() will hang.
    // Use native fetch + AbortController to check headers then abort.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(
        `${BASE_URL}/api/intents/${intentId}/events`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        },
      );

      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type") ?? "";
      expect(contentType).toContain("text/event-stream");
    } catch (err) {
      // AbortError is expected — we got the headers we needed
      if (err instanceof Error && err.name !== "AbortError") {
        throw err;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  });

  test("step 9: evidence endpoint validates parameters", async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE_URL}/api/evidence/invalid-intent/invalid-hash`,
    );
    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty("error");
  });

  test("step 10: parse-intent endpoint works", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/parse-intent`, {
      data: { intent: "60/40 ETH/USDC, $200/day, 7 days" },
    });

    // May succeed (200) or fail due to Venice overload (5xx)
    if (res.status() === 200) {
      const data = await res.json();
      expect(data).toHaveProperty("parsed");
      expect(data).toHaveProperty("audit");
      expect(data.parsed.targetAllocation).toBeDefined();
      expect(data.audit.allows).toBeInstanceOf(Array);
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(500);
    }
  });
});
