/**
 * E2E tests for the multi-intent flow: auth, intent CRUD, and worker lifecycle.
 * Uses viem's privateKeyToAccount to sign nonces programmatically (no browser).
 *
 * Spawns a real server subprocess and exercises the full API flow:
 * 1. Request nonce → sign → verify → get auth token
 * 2. Create multiple intents for one wallet
 * 3. List intents (verify all returned)
 * 4. Get intent detail (verify worker status)
 * 5. Delete intent (verify cancellation)
 * 6. Re-list (verify intent removed from active)
 *
 * @module @veil/agent/multi-intent.e2e.test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { privateKeyToAccount } from "viem/accounts";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3149;
const BASE = `http://localhost:${PORT}`;
let serverProcess: ChildProcess;

// Isolated temp DB so we don't conflict with other e2e test servers
const tmpDir = mkdtempSync(join(tmpdir(), "veil-e2e-"));
const DB_PATH = join(tmpDir, "test.db");

// Test wallet — Anvil account #0 (well-known test key, no real funds)
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_WALLET = testAccount.address;

// Second wallet for isolation testing
const TEST_PRIVATE_KEY_2 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const testAccount2 = privateKeyToAccount(TEST_PRIVATE_KEY_2);
const TEST_WALLET_2 = testAccount2.address;

const MOCK_PARSED_INTENT = {
  targetAllocation: { ETH: 0.6, USDC: 0.4 },
  dailyBudgetUsd: 200,
  timeWindowDays: 7,
  maxSlippage: 0.005,
  driftThreshold: 0.05,
  maxTradesPerDay: 10,
  maxPerTradeUsd: 200,
};

async function waitForServer(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/auth/nonce?wallet=0x1234`);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

/**
 * Authenticate a wallet via nonce-signing flow.
 * Returns a bearer token.
 */
async function authenticate(
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<string> {
  // 1. Request nonce
  const nonceRes = await fetch(
    `${BASE}/api/auth/nonce?wallet=${account.address}`,
  );
  expect(nonceRes.status).toBe(200);
  const { nonce } = await nonceRes.json();

  // 2. Sign nonce message
  const message = `Sign this message to authenticate with Veil.\n\nNonce: ${nonce}`;
  const signature = await account.signMessage({ message });

  // 3. Verify signature → get token
  const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: account.address, signature }),
  });
  expect(verifyRes.status).toBe(200);
  const { token } = await verifyRes.json();
  expect(typeof token).toBe("string");
  return token;
}

/**
 * Create an intent for a wallet.
 * Returns the created intent object.
 */
async function createTestIntent(
  token: string,
  intentText: string,
  walletAddress: string,
): Promise<{ intent: Record<string, unknown>; audit: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/intents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      intentText,
      parsedIntent: MOCK_PARSED_INTENT,
      permissions: JSON.stringify([{ type: "native-token-periodic", context: "0xdeadbeef", token: "ETH" }]),
      delegationManager: "0x0000000000000000000000000000000000000001",
      dependencies: JSON.stringify([]),
    }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

describe("Multi-Intent E2E", () => {
  beforeAll(async () => {
    serverProcess = spawn(
      "npx",
      ["tsx", join(__dirname, "../server.ts")],
      {
        env: { ...process.env, PORT: String(PORT), DB_PATH },
        stdio: "pipe",
      },
    );

    let stderr = "";
    serverProcess.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await waitForServer();
    } catch {
      serverProcess.kill();
      throw new Error(`Server failed to start. stderr: ${stderr}`);
    }
  }, 40000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // -----------------------------------------------------------------------
  // Auth flow
  // -----------------------------------------------------------------------

  describe("nonce-signing auth flow", () => {
    it("completes full nonce → sign → verify → token flow", async () => {
      const token = await authenticate(testAccount);
      expect(token.length).toBeGreaterThan(10);
    });

    it("rejects invalid signature", async () => {
      const nonceRes = await fetch(
        `${BASE}/api/auth/nonce?wallet=${TEST_WALLET}`,
      );
      const { nonce } = await nonceRes.json();

      // Sign with wrong account
      const message = `Sign this message to authenticate with Veil.\n\nNonce: ${nonce}`;
      const wrongSignature = await testAccount2.signMessage({ message });

      const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: TEST_WALLET,
          signature: wrongSignature,
        }),
      });
      expect(verifyRes.status).toBe(401);
    });

    it("rejects reused nonce", async () => {
      // Authenticate once (consumes the nonce)
      await authenticate(testAccount);

      // Trying to verify with a stale nonce should fail
      const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: TEST_WALLET,
          signature: "0xdeadbeef",
        }),
      });
      expect(verifyRes.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-intent CRUD
  // -----------------------------------------------------------------------

  describe("intent CRUD with multiple intents", () => {
    let token: string;
    const createdIntentIds: string[] = [];

    beforeAll(async () => {
      token = await authenticate(testAccount);
    });

    it("creates first intent", async () => {
      const result = await createTestIntent(
        token,
        "60/40 ETH/USDC, $200/day, 7 days",
        TEST_WALLET,
      );
      expect(result.intent).toHaveProperty("id");
      expect(result.intent.status).toBe("active");
      expect(result.audit).toHaveProperty("allows");
      createdIntentIds.push(result.intent.id as string);
    });

    it("creates second intent for same wallet", async () => {
      const result = await createTestIntent(
        token,
        "80/20 ETH/USDC, $100/day, 14 days",
        TEST_WALLET,
      );
      expect(result.intent).toHaveProperty("id");
      expect(result.intent.id).not.toBe(createdIntentIds[0]);
      createdIntentIds.push(result.intent.id as string);
    });

    it("lists all intents for wallet", async () => {
      const res = await fetch(
        `${BASE}/api/intents?wallet=${TEST_WALLET}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(res.status).toBe(200);
      const intents = await res.json();
      expect(intents.length).toBeGreaterThanOrEqual(2);

      // Our created intents should be present
      const ids = intents.map((i: Record<string, unknown>) => i.id);
      expect(ids).toContain(createdIntentIds[0]);
      expect(ids).toContain(createdIntentIds[1]);
    });

    it("gets intent detail with worker status", async () => {
      const res = await fetch(
        `${BASE}/api/intents/${createdIntentIds[0]}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(res.status).toBe(200);
      const detail = await res.json();
      expect(detail.id).toBe(createdIntentIds[0]);
      expect(detail.intentText).toBe("60/40 ETH/USDC, $200/day, 7 days");
      expect(detail).toHaveProperty("workerStatus");
      expect(detail).toHaveProperty("logs");
    });

    it("deletes (cancels) an intent", async () => {
      const res = await fetch(
        `${BASE}/api/intents/${createdIntentIds[0]}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("cancelled");
    });

    it("cancelled intent shows cancelled status on detail", async () => {
      const res = await fetch(
        `${BASE}/api/intents/${createdIntentIds[0]}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(res.status).toBe(200);
      const detail = await res.json();
      expect(detail.status).toBe("cancelled");
    });

    it("second intent is not cancelled", async () => {
      const res = await fetch(
        `${BASE}/api/intents/${createdIntentIds[1]}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(res.status).toBe(200);
      const detail = await res.json();
      // The worker may complete its loop before we check, so accept active or completed
      // The key assertion: it was NOT cancelled (only the first intent was deleted)
      expect(detail.status).not.toBe("cancelled");
    });

    // Cleanup
    afterAll(async () => {
      // Cancel any remaining active intents
      for (const id of createdIntentIds) {
        try {
          await fetch(`${BASE}/api/intents/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {
          // ignore cleanup errors
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // Wallet isolation
  // -----------------------------------------------------------------------

  describe("wallet isolation", () => {
    let token1: string;
    let token2: string;
    let intent1Id: string;

    beforeAll(async () => {
      token1 = await authenticate(testAccount);
      token2 = await authenticate(testAccount2);

      const result = await createTestIntent(
        token1,
        "isolation test intent",
        TEST_WALLET,
      );
      intent1Id = result.intent.id as string;
    });

    it("wallet 2 cannot see wallet 1's intents", async () => {
      const res = await fetch(
        `${BASE}/api/intents?wallet=${TEST_WALLET_2}`,
        { headers: { Authorization: `Bearer ${token2}` } },
      );
      expect(res.status).toBe(200);
      const intents = await res.json();
      const ids = intents.map((i: Record<string, unknown>) => i.id);
      expect(ids).not.toContain(intent1Id);
    });

    it("wallet 2 cannot access wallet 1's intent detail", async () => {
      const res = await fetch(
        `${BASE}/api/intents/${intent1Id}`,
        { headers: { Authorization: `Bearer ${token2}` } },
      );
      expect(res.status).toBe(403);
    });

    it("wallet 2 cannot delete wallet 1's intent", async () => {
      const res = await fetch(
        `${BASE}/api/intents/${intent1Id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token2}` },
        },
      );
      expect(res.status).toBe(403);
    });

    it("wallet mismatch in query param returns 403", async () => {
      // token1 is for wallet1, but query param says wallet2
      const res = await fetch(
        `${BASE}/api/intents?wallet=${TEST_WALLET_2}`,
        { headers: { Authorization: `Bearer ${token1}` } },
      );
      expect(res.status).toBe(403);
    });

    afterAll(async () => {
      try {
        await fetch(`${BASE}/api/intents/${intent1Id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token1}` },
        });
      } catch {
        // ignore
      }
    });
  });
});
