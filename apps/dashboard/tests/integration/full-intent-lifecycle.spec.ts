/**
 * Full intent lifecycle e2e test against a live deployment.
 *
 * Exercises the complete flow: auth → create intent → list → detail → cancel.
 * Uses a random wallet (viem) to sign the nonce — no browser wallet needed.
 *
 * Run against VPS:
 *   INTEGRATION=1 DEPLOYED_URL=https://api.veil.moe pnpm --filter @veil/dashboard test:e2e --project integration -g "Full Intent Lifecycle"
 *
 * Run against Vercel:
 *   INTEGRATION=1 DEPLOYED_URL=https://veil.moe pnpm --filter @veil/dashboard test:e2e --project integration -g "Full Intent Lifecycle"
 *
 * @module @veil/dashboard/tests/integration/full-intent-lifecycle.spec
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

test.describe("Full Intent Lifecycle", () => {
  // Shared state across serial tests
  let wallet: string;
  let token: string;
  let intentId: string;

  // Generate a fresh test wallet for isolation
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  test.beforeAll(() => {
    wallet = account.address;
  });

  test("step 1: get auth nonce", async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/auth/nonce?wallet=${wallet}`,
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(typeof data.nonce).toBe("string");
    expect(data.nonce.length).toBeGreaterThan(0);

    // Sign the nonce message (same format as auth.ts)
    const message = `Sign this message to authenticate with Veil.\n\nNonce: ${data.nonce}`;
    const signature = await account.signMessage({ message });

    // Verify signature to get bearer token
    const verifyRes = await request.post(`${BASE_URL}/api/auth/verify`, {
      data: { wallet, signature },
    });
    expect(verifyRes.status()).toBe(200);
    const verifyData = await verifyRes.json();
    expect(typeof verifyData.token).toBe("string");
    token = verifyData.token;
  });

  test("step 2: create intent", async ({ request }) => {
    expect(token).toBeDefined();

    const res = await request.post(`${BASE_URL}/api/intents`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        intentText: "E2E test: 60/40 ETH/USDC, $100/day, 7 days",
        parsedIntent: VALID_PARSED_INTENT,
        permissions: "[{\"type\":\"native-token-periodic\",\"context\":\"0xdeadbeef_e2e_test\",\"token\":\"ETH\"}]",
        delegationManager: "0x0000000000000000000000000000000000E2E001",
        dependencies: "[]",
      },
    });

    expect(res.status()).toBe(201);
    const data = await res.json();

    expect(data).toHaveProperty("intent");
    expect(data).toHaveProperty("audit");
    expect(data.intent.id).toBeTruthy();
    expect(data.intent.walletAddress).toBe(wallet.toLowerCase());
    expect(data.intent.intentText).toContain("E2E test");
    expect(data.intent.status).toMatch(/active|failed/);
    expect(data.audit.allows).toBeInstanceOf(Array);
    expect(data.audit.prevents).toBeInstanceOf(Array);

    intentId = data.intent.id;
  });

  test("step 3: list intents shows the new intent", async ({ request }) => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    const res = await request.get(
      `${BASE_URL}/api/intents?wallet=${wallet}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const intents = await res.json();
    expect(Array.isArray(intents)).toBe(true);

    const found = intents.find(
      (i: { id: string }) => i.id === intentId,
    );
    expect(found).toBeDefined();
    expect(found.intentText).toContain("E2E test");
  });

  test("step 4: get intent detail", async ({ request }) => {
    expect(token).toBeDefined();
    expect(intentId).toBeDefined();

    const res = await request.get(
      `${BASE_URL}/api/intents/${intentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status()).toBe(200);
    const data = await res.json();

    expect(data.id).toBe(intentId);
    expect(data.walletAddress).toBe(wallet.toLowerCase());
    expect(data).toHaveProperty("logs");
    expect(data).toHaveProperty("liveState");
    expect(data).toHaveProperty("workerStatus");
    // parsedIntent is stored as JSON string — should roundtrip
    const parsed = JSON.parse(data.parsedIntent);
    expect(parsed.targetAllocation.ETH).toBe(0.6);
    expect(parsed.targetAllocation.USDC).toBe(0.4);
    expect(parsed.dailyBudgetUsd).toBe(100);
  });

  test("step 5: cancel (delete) intent", async ({ request }) => {
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

  test("step 6: verify intent is cancelled", async ({ request }) => {
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

  test("step 7: auth is wallet-scoped (other wallet cannot see intent)", async ({
    request,
  }) => {
    // Auth as a different wallet
    const otherKey = generatePrivateKey();
    const otherAccount = privateKeyToAccount(otherKey);

    const nonceRes = await request.get(
      `${BASE_URL}/api/auth/nonce?wallet=${otherAccount.address}`,
    );
    const { nonce } = await nonceRes.json();
    const message = `Sign this message to authenticate with Veil.\n\nNonce: ${nonce}`;
    const sig = await otherAccount.signMessage({ message });

    const verifyRes = await request.post(`${BASE_URL}/api/auth/verify`, {
      data: { wallet: otherAccount.address, signature: sig },
    });
    const { token: otherToken } = await verifyRes.json();

    // Try to access the first wallet's intent — should get 403
    const res = await request.get(
      `${BASE_URL}/api/intents/${intentId}`,
      { headers: { Authorization: `Bearer ${otherToken}` } },
    );
    expect(res.status()).toBe(403);
  });
});
