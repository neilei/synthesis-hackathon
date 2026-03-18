import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createIntentRoutes } from "../intents.js";
import { requireAuth, type AuthEnv } from "../../middleware/auth.js";
import type { IntentRepository } from "../../db/repository.js";
import type { WorkerPool } from "../../worker-pool.js";

// Mock auth — always returns a wallet for these tests
vi.mock("../../auth.js", () => ({
  verifyAuthToken: vi.fn().mockReturnValue("0xwallet123"),
  generateNonce: vi.fn(),
  createAuthToken: vi.fn(),
  NONCE_TTL_SECONDS: 300,
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn().mockReturnValue("test-intent-id"),
}));

vi.mock("@veil/common", async () => {
  const { z } = await import("zod");
  return {
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

vi.mock("../../logging/intent-log.js", () => {
  class MockLogger {
    log = vi.fn();
    readAll = vi.fn().mockReturnValue([]);
    getFilePath = vi.fn().mockReturnValue("/tmp/nonexistent.jsonl");
  }
  return { IntentLogger: MockLogger };
});

vi.mock("../../logging/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Partial mock: only methods used by route handlers are stubbed
function createMockRepo(): IntentRepository {
  return {
    createIntent: vi.fn().mockImplementation((data) => ({
      ...data,
      status: "active",
    })),
    getIntent: vi.fn(),
    getIntentsByWallet: vi.fn().mockReturnValue([]),
    getActiveIntents: vi.fn().mockReturnValue([]),
    updateIntentStatus: vi.fn(),
    updateIntentCycleState: vi.fn(),
    updateIntentAgentId: vi.fn(),
    markExpiredIntents: vi.fn(),
    insertSwap: vi.fn(),
    getSwapsByIntent: vi.fn(),
    insertLog: vi.fn(),
    getIntentLogs: vi.fn().mockReturnValue([]),
    upsertNonce: vi.fn(),
    getNonce: vi.fn(),
    deleteNonce: vi.fn(),
  } as unknown as IntentRepository; // partial mock — class has private DB handle we can't construct here

}

// Partial mock: only methods used by route handlers are stubbed
function createMockWorkerPool(): WorkerPool {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue("stopped"),
    getQueuePosition: vi.fn().mockReturnValue(null),
    getState: vi.fn().mockReturnValue(null),
    activeCount: vi.fn().mockReturnValue(0),
    queuedCount: vi.fn().mockReturnValue(0),
    shutdown: vi.fn().mockResolvedValue(undefined),
    setWorkerFactory: vi.fn(),
  } as unknown as WorkerPool; // partial mock — class requires DB constructor args
}

const AUTH_HEADER = { Authorization: "Bearer valid-token" };

function buildApp(repo: IntentRepository, pool: WorkerPool) {
  const root = new Hono<AuthEnv>();
  root.use("/*", requireAuth);
  root.route("/", createIntentRoutes({ repo, workerPool: pool }));
  return root;
}

describe("intent routes", () => {
  let repo: IntentRepository;
  let pool: WorkerPool;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockRepo();
    pool = createMockWorkerPool();
  });

  describe("POST / (create intent)", () => {
    const validBody = {
      intentText: "60/40 ETH/USDC",
      parsedIntent: {
        targetAllocation: { ETH: 60, USDC: 40 },
        dailyBudgetUsd: 200,
        timeWindowDays: 7,
        maxTradesPerDay: 5,
        maxSlippage: 0.5,
        driftThreshold: 5,
      },
      signedDelegation: "0xdelegation",
      delegatorSmartAccount: "0xsmartaccount",
    };

    it("creates an intent and returns 201", async () => {
      const app = buildApp(repo, pool);
      const res = await app.request("/", {
        method: "POST",
        headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.intent).toBeDefined();
      expect(body.audit).toBeDefined();
      expect(vi.mocked(pool.start)).toHaveBeenCalledWith("test-intent-id");
    });

    it("returns 400 when required fields are missing", async () => {
      const app = buildApp(repo, pool);
      const res = await app.request("/", {
        method: "POST",
        headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({ intentText: "hello" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when parsedIntent fails validation", async () => {
      const app = buildApp(repo, pool);
      const res = await app.request("/", {
        method: "POST",
        headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validBody,
          parsedIntent: { targetAllocation: "bad" },
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 401 without auth", async () => {
      const app = buildApp(repo, pool);
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET / (list intents)", () => {
    it("returns intents for the authenticated wallet", async () => {
      vi.mocked(repo.getIntentsByWallet).mockReturnValue([
        { id: "i1", walletAddress: "0xwallet123", status: "active" },
      ] as never); // partial intent object — full DB row shape not needed for this test

      const app = buildApp(repo, pool);
      const res = await app.request("/", { headers: AUTH_HEADER });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("returns 403 when wallet query param doesn't match auth", async () => {
      const app = buildApp(repo, pool);
      const res = await app.request("/?wallet=0xother", {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /:id (get intent)", () => {
    it("returns intent detail with worker status and logs", async () => {
      vi.mocked(repo.getIntent).mockReturnValue({
        id: "i1",
        walletAddress: "0xwallet123",
        status: "active",
      } as never); // partial intent object — full DB row shape not needed for this test

      const app = buildApp(repo, pool);
      const res = await app.request("/i1", { headers: AUTH_HEADER });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workerStatus).toBeDefined();
      expect(body.logs).toBeDefined();
    });

    it("returns 404 when intent not found", async () => {
      vi.mocked(repo.getIntent).mockReturnValue(null);
      const app = buildApp(repo, pool);
      const res = await app.request("/nonexistent", {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(404);
    });

    it("returns 403 when intent belongs to different wallet", async () => {
      vi.mocked(repo.getIntent).mockReturnValue({
        id: "i1",
        walletAddress: "0xother",
        status: "active",
      } as never); // partial intent object — full DB row shape not needed for this test

      const app = buildApp(repo, pool);
      const res = await app.request("/i1", { headers: AUTH_HEADER });
      expect(res.status).toBe(403);
    });

    it("parses JSON blob result and parameters in logs", async () => {
      vi.mocked(repo.getIntent).mockReturnValue({
        id: "i1",
        walletAddress: "0xwallet123",
        status: "active",
      } as never);

      vi.mocked(repo.getIntentLogs).mockReturnValue([
        {
          id: 1,
          intentId: "i1",
          timestamp: "2026-03-18T00:00:00Z",
          sequence: 0,
          action: "price_fetch",
          cycle: 1,
          tool: null,
          parameters: '{"token":"ETH"}',
          result: '{"price":2331.2}',
          durationMs: 150,
          error: null,
        },
        {
          id: 2,
          intentId: "i1",
          timestamp: "2026-03-18T00:01:00Z",
          sequence: 1,
          action: "worker_start",
          cycle: null,
          tool: null,
          parameters: null,
          result: null,
          durationMs: null,
          error: null,
        },
      ] as never);

      const app = buildApp(repo, pool);
      const res = await app.request("/i1", { headers: AUTH_HEADER });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.logs).toHaveLength(2);
      // Verify JSON blobs are parsed into objects
      expect(body.logs[0].result).toEqual({ price: 2331.2 });
      expect(body.logs[0].parameters).toEqual({ token: "ETH" });
      // Verify null blobs become undefined
      expect(body.logs[1].result).toBeUndefined();
      expect(body.logs[1].parameters).toBeUndefined();
    });

    it("includes queuePosition in response", async () => {
      vi.mocked(repo.getIntent).mockReturnValue({
        id: "i1",
        walletAddress: "0xwallet123",
        status: "active",
      } as never);
      vi.mocked(pool.getQueuePosition).mockReturnValue(2);

      const app = buildApp(repo, pool);
      const res = await app.request("/i1", { headers: AUTH_HEADER });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.queuePosition).toBe(2);
    });
  });

  describe("DELETE /:id (cancel intent)", () => {
    it("cancels an intent and stops the worker", async () => {
      vi.mocked(repo.getIntent).mockReturnValue({
        id: "i1",
        walletAddress: "0xwallet123",
        status: "active",
      } as never); // partial intent object — full DB row shape not needed for this test

      const app = buildApp(repo, pool);
      const res = await app.request("/i1", {
        method: "DELETE",
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("cancelled");
      expect(vi.mocked(pool.stop)).toHaveBeenCalledWith("i1");
      expect(vi.mocked(repo.updateIntentStatus)).toHaveBeenCalledWith(
        "i1",
        "cancelled",
      );
    });

    it("returns 404 when intent not found", async () => {
      vi.mocked(repo.getIntent).mockReturnValue(null);
      const app = buildApp(repo, pool);
      const res = await app.request("/missing", {
        method: "DELETE",
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(404);
    });

    it("returns 403 when intent belongs to different wallet", async () => {
      vi.mocked(repo.getIntent).mockReturnValue({
        id: "i1",
        walletAddress: "0xother",
        status: "active",
      } as never); // partial intent object — full DB row shape not needed for this test

      const app = buildApp(repo, pool);
      const res = await app.request("/i1", {
        method: "DELETE",
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /:id/logs", () => {
    it("returns empty ndjson when log file does not exist", async () => {
      vi.mocked(repo.getIntent).mockReturnValue({
        id: "i1",
        walletAddress: "0xwallet123",
        status: "active",
      } as never); // partial intent object — full DB row shape not needed for this test

      const app = buildApp(repo, pool);
      const res = await app.request("/i1/logs", { headers: AUTH_HEADER });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(
        "application/x-ndjson",
      );
    });

    it("returns 404 when intent not found for logs", async () => {
      vi.mocked(repo.getIntent).mockReturnValue(null);
      const app = buildApp(repo, pool);
      const res = await app.request("/missing/logs", {
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(404);
    });

    it("returns 403 when intent belongs to different wallet for logs", async () => {
      vi.mocked(repo.getIntent).mockReturnValue({
        id: "i1",
        walletAddress: "0xother",
        status: "active",
      } as never); // partial intent object — full DB row shape not needed for this test

      const app = buildApp(repo, pool);
      const res = await app.request("/i1/logs", { headers: AUTH_HEADER });
      expect(res.status).toBe(403);
    });
  });
});
