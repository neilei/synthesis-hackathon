/**
 * Integration tests for the Hono server — CORS, routing, SPA fallback.
 * Route handler logic is tested in routes/__tests__/*.test.ts.
 *
 * @module @veil/agent/server.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all heavy dependencies (prevents real crypto/DB/network)
// ---------------------------------------------------------------------------
vi.mock("../config.js", () => ({
  env: {
    VENICE_API_KEY: "x",
    VENICE_BASE_URL: "https://x",
    UNISWAP_API_KEY: "x",
    AGENT_PRIVATE_KEY:
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  },
  CONTRACTS: {},
  CHAINS: {},
  UNISWAP_API_BASE: "",
  THEGRAPH_UNISWAP_V3_BASE: "",
}));
vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({
    address: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
  }),
}));
vi.mock("../delegation/compiler.js", () => ({
  compileIntent: vi.fn(),
}));
vi.mock("../identity/erc8004.js", () => ({
  registerAgent: vi.fn().mockResolvedValue({ txHash: "0xabc", agentId: 1n }),
}));
vi.mock("../logging/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../utils/retry.js", () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));
vi.mock("../db/connection.js", () => ({
  getDb: vi.fn().mockReturnValue({}),
}));
vi.mock("../db/repository.js", () => {
  class MockRepo {
    createIntent = vi.fn();
    getIntent = vi.fn();
    getIntentsByWallet = vi.fn().mockReturnValue([]);
    getActiveIntents = vi.fn().mockReturnValue([]);
    updateIntentStatus = vi.fn();
    updateIntentCycleState = vi.fn();
    updateIntentAgentId = vi.fn();
    markExpiredIntents = vi.fn();
    insertSwap = vi.fn();
    getSwapsByIntent = vi.fn();
    upsertNonce = vi.fn();
    getNonce = vi.fn();
    deleteNonce = vi.fn();
  }
  return { IntentRepository: MockRepo };
});
vi.mock("../worker-pool.js", () => {
  class MockPool {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    getStatus = vi.fn().mockReturnValue("stopped");
    getState = vi.fn().mockReturnValue(null);
    activeCount = vi.fn().mockReturnValue(0);
    queuedCount = vi.fn().mockReturnValue(0);
    shutdown = vi.fn().mockResolvedValue(undefined);
    setWorkerFactory = vi.fn();
  }
  return { WorkerPool: MockPool };
});
vi.mock("../logging/intent-log.js", () => {
  class MockLogger {
    log = vi.fn();
    readAll = vi.fn().mockReturnValue([]);
    getFilePath = vi.fn().mockReturnValue("data/logs/mock.jsonl");
  }
  return { IntentLogger: MockLogger };
});
vi.mock("../agent-worker.js", () => {
  class MockWorker {
    intentId: string;
    constructor(intentId: string) {
      this.intentId = intentId;
    }
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    isRunning = vi.fn().mockReturnValue(false);
    getState = vi.fn().mockReturnValue(null);
  }
  return { DefaultAgentWorker: MockWorker };
});
vi.mock("../auth.js", () => ({
  generateNonce: vi.fn().mockReturnValue("mock-nonce-123"),
  createAuthToken: vi.fn().mockReturnValue("mock-token"),
  verifyAuthToken: vi.fn().mockReturnValue(null),
  NONCE_TTL_SECONDS: 300,
}));
vi.mock("../startup.js", () => ({
  resumeActiveIntents: vi.fn().mockResolvedValue({ expired: 0, resumed: 0 }),
}));
vi.mock("@veil/common", async () => {
  const { z } = await import("zod");
  return {
    DEFAULT_AGENT_PORT: 3147,
    API_PATHS: {
      authNonce: "/api/auth/nonce",
      authVerify: "/api/auth/verify",
      parseIntent: "/api/parse-intent",
      intents: "/api/intents",
    },
    ParsedIntentSchema: z.object({
      targetAllocation: z.record(z.string(), z.number()),
      dailyBudgetUsd: z.number(),
      timeWindowDays: z.number(),
      maxTradesPerDay: z.number(),
      maxSlippage: z.number(),
      driftThreshold: z.number(),
    }),
    computeExpiryTimestamp: vi
      .fn()
      .mockReturnValue(Math.floor(Date.now() / 1000) + 86400),
    generateAuditReport: vi.fn().mockReturnValue({
      allows: [],
      prevents: [],
      worstCase: "",
      warnings: [],
    }),
  };
});
vi.mock("../agent-loop.js", () => ({}));

// Mock @hono/node-server so startup() doesn't actually bind a port
vi.mock("@hono/node-server", () => ({
  serve: vi.fn((_opts: unknown, cb?: () => void) => {
    if (cb) cb();
  }),
}));
vi.mock("@hono/node-server/serve-static", () => ({
  serveStatic: vi.fn().mockReturnValue(
    async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

// ---------------------------------------------------------------------------
// Import the app AFTER mocks are set up
// ---------------------------------------------------------------------------

const { app } = await import("../server.js");

// startup() is fire-and-forget at module level — wait for it to complete
await new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CORS", () => {
  it("OPTIONS returns 204 with CORS headers", async () => {
    const res = await app.request("/api/parse-intent", {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "Content-Type",
    );
  });

  it("JSON responses include CORS headers", async () => {
    const res = await app.request("/api/auth/nonce?wallet=0x1234");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("Route dispatch", () => {
  it("GET /api/auth/nonce returns nonce", async () => {
    const res = await app.request("/api/auth/nonce?wallet=0x1234");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nonce).toBe("mock-nonce-123");
  });

  it("GET /api/auth/nonce returns 400 without wallet", async () => {
    const res = await app.request("/api/auth/nonce");
    expect(res.status).toBe(400);
  });

  it("GET /api/intents returns 401 without auth", async () => {
    const res = await app.request("/api/intents");
    expect(res.status).toBe(401);
  });

  it("POST /api/parse-intent returns 400 for missing intent", async () => {
    const res = await app.request("/api/parse-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing intent");
  });

  it("DELETE /api/intents/:id returns 401 without auth", async () => {
    const res = await app.request("/api/intents/some-id", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/intents/:id/logs returns 401 without auth", async () => {
    const res = await app.request("/api/intents/some-id/logs");
    expect(res.status).toBe(401);
  });
});

describe("SPA fallback", () => {
  it("GET / returns HTML", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("VEIL");
  });

  it("GET /nonexistent returns HTML (not JSON 404)", async () => {
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
  });

  it("GET /dashboard returns HTML", async () => {
    const res = await app.request("/dashboard");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("VEIL");
  });
});
