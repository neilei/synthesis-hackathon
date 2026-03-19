/**
 * Intent lifecycle e2e test — spawns agent server, exercises full
 * auth → create → detail → SSE → cancel → isolation flow.
 *
 * @module @veil/agent/__tests__/lifecycle.e2e.test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3149;
const BASE = `http://localhost:${PORT}`;
let serverProcess: ChildProcess;

const tmpDir = mkdtempSync(join(tmpdir(), "veil-lifecycle-e2e-"));
const DB_PATH = join(tmpDir, "test.db");

async function waitForServer(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/auth/nonce?wallet=0x1234`);
      if (res.ok) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

async function getAuthToken(): Promise<{ wallet: string; token: string }> {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const wallet = account.address;

  const nonceRes = await fetch(`${BASE}/api/auth/nonce?wallet=${wallet}`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const message = `Sign this message to authenticate with Veil.\n\nNonce: ${nonce}`;
  const signature = await account.signMessage({ message });

  const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, signature }),
  });
  const { token } = (await verifyRes.json()) as { token: string };
  return { wallet, token };
}

const VALID_PARSED_INTENT = {
  targetAllocation: { ETH: 0.6, USDC: 0.4 },
  dailyBudgetUsd: 100,
  timeWindowDays: 7,
  maxTradesPerDay: 5,
  maxPerTradeUsd: 100,
  maxSlippage: 0.005,
  driftThreshold: 0.05,
};

describe("Intent Lifecycle E2E", () => {
  let auth: { wallet: string; token: string };
  let intentId: string;

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

    auth = await getAuthToken();
  }, 40000);

  afterAll(() => {
    serverProcess?.kill("SIGTERM");
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates an intent and worker starts", async () => {
    const res = await fetch(`${BASE}/api/intents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        intentText: "E2E lifecycle: 60/40 ETH/USDC, $100/day, 7 days",
        parsedIntent: VALID_PARSED_INTENT,
        signedDelegation: "0xdeadbeef_lifecycle_test",
        delegatorSmartAccount: "0x0000000000000000000000000000000000E2E099",
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    intentId = data.intent.id;
    expect(intentId).toBeTruthy();
    expect(data.intent.status).toMatch(/active|failed/);
  });

  it("intent detail returns workerStatus and logs", async () => {
    await new Promise((r) => setTimeout(r, 2000));

    const res = await fetch(`${BASE}/api/intents/${intentId}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.id).toBe(intentId);
    expect(data).toHaveProperty("workerStatus");
    expect(data).toHaveProperty("logs");
    expect(Array.isArray(data.logs)).toBe(true);

    if (data.logs.length > 0) {
      const firstLog = data.logs[0];
      expect(firstLog).toHaveProperty("action");
      expect(firstLog).toHaveProperty("sequence");
      expect(firstLog).toHaveProperty("timestamp");

      if (firstLog.result) {
        expect(typeof firstLog.result).toBe("object");
      }
    }
  });

  it("intent list shows the intent sorted descending", async () => {
    const res = await fetch(`${BASE}/api/intents?wallet=${auth.wallet}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(res.status).toBe(200);

    const intents = await res.json();
    expect(Array.isArray(intents)).toBe(true);
    expect(intents.length).toBeGreaterThanOrEqual(1);
    expect(intents[0].id).toBe(intentId);
  });

  it("SSE endpoint streams events with auth", async () => {
    const controller = new AbortController();
    const res = await fetch(`${BASE}/api/intents/${intentId}/events`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/event-stream");

    controller.abort();
  });

  it("SSE endpoint rejects without auth", async () => {
    const res = await fetch(`${BASE}/api/intents/${intentId}/events`);
    expect(res.status).toBe(401);
  });

  it("cancels the intent and worker stops", async () => {
    const res = await fetch(`${BASE}/api/intents/${intentId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("cancelled");
  });

  it("cancelled intent shows stopped worker", async () => {
    const res = await fetch(`${BASE}/api/intents/${intentId}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("cancelled");
    expect(data.workerStatus).toBe("stopped");
  });

  it("wallet isolation: other wallet cannot access intent", async () => {
    const other = await getAuthToken();
    const res = await fetch(`${BASE}/api/intents/${intentId}`, {
      headers: { Authorization: `Bearer ${other.token}` },
    });
    expect(res.status).toBe(403);
  });
});
