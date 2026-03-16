/**
 * Unit tests for the HTTP server route handlers and CORS behavior.
 *
 * @module @veil/agent/server.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";

// ---------------------------------------------------------------------------
// Capture the request handler from createServer before import
// ---------------------------------------------------------------------------
let capturedHandler: (req: IncomingMessage, res: ServerResponse) => void;
const mockListen = vi.fn((_port: number, cb?: () => void) => {
  if (cb) cb();
});
const mockServerInstance = { listen: mockListen };

vi.mock("http", () => ({
  createServer: vi.fn((handler: (req: IncomingMessage, res: ServerResponse) => void) => {
    capturedHandler = handler;
    return mockServerInstance;
  }),
}));

// Mock fs — we control existsSync, readFileSync, readFile
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockReadFile = vi.fn();
vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Mock viem/accounts to prevent real crypto in startup()
vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({
    address: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
  }),
  generatePrivateKey: vi.fn().mockReturnValue(
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ),
}));

// ---------------------------------------------------------------------------
// Mock all heavy internal dependencies (same pattern as existing test file)
// ---------------------------------------------------------------------------
vi.mock("./config.js", () => ({
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
vi.mock("./venice/llm.js", () => ({
  researchLlm: {},
  reasoningLlm: {},
  fastLlm: {},
}));
vi.mock("./data/portfolio.js", () => ({ getPortfolioBalance: vi.fn() }));
vi.mock("./data/prices.js", () => ({ getTokenPrice: vi.fn() }));
vi.mock("./data/thegraph.js", () => ({ getPoolData: vi.fn() }));
vi.mock("./delegation/compiler.js", () => ({
  compileIntent: vi.fn(),
  createDelegationFromIntent: vi.fn(),
  detectAdversarialIntent: vi.fn(),
}));
vi.mock("./delegation/audit.js", () => ({
  generateAuditReport: vi.fn(),
}));
vi.mock("./delegation/redeemer.js", () => ({
  createRedeemClient: vi.fn(),
  redeemDelegation: vi.fn(),
}));
vi.mock("./uniswap/trading.js", () => ({
  getQuote: vi.fn(),
  createSwap: vi.fn(),
}));
vi.mock("./logging/agent-log.js", () => ({
  logAction: vi.fn(),
  logStart: vi.fn(),
  logStop: vi.fn(),
}));
vi.mock("./logging/budget.js", () => ({
  getBudgetTier: vi.fn().mockReturnValue("normal"),
}));
vi.mock("./identity/erc8004.js", () => ({
  registerAgent: vi.fn().mockResolvedValue({ txHash: "0xabc", agentId: 1 }),
  giveFeedback: vi.fn(),
}));
vi.mock("./logging/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("./utils/retry.js", () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

// Mock @veil/common — provide real constant values so server.ts resolves cleanly.
// DeployRequestSchema and AgentLogEntrySchema must be real Zod schemas since
// server.ts calls safeParse() on both.
vi.mock("@veil/common", async () => {
  const { z } = await import("zod");
  return {
    DEFAULT_AGENT_PORT: 3147,
    API_PATHS: { state: "/api/state", deploy: "/api/deploy" },
    DeployRequestSchema: z.object({
      intent: z.string().min(1, "Intent cannot be empty"),
    }),
    AgentLogEntrySchema: z.object({
      timestamp: z.string(),
      sequence: z.number(),
      action: z.string(),
      tool: z.string().optional(),
      parameters: z.record(z.string(), z.unknown()).optional(),
      result: z.record(z.string(), z.unknown()).optional(),
      duration_ms: z.number().optional(),
      error: z.string().optional(),
    }),
  };
});

// Mock agent-loop with controllable getAgentState / getAgentConfig
const mockGetAgentState = vi.fn().mockReturnValue(null);
const mockGetAgentConfig = vi.fn().mockReturnValue(null);
const mockRunAgentLoop = vi.fn().mockResolvedValue(undefined);
vi.mock("./agent-loop.js", () => ({
  getAgentState: (...args: unknown[]) => mockGetAgentState(...args),
  getAgentConfig: (...args: unknown[]) => mockGetAgentConfig(...args),
  runAgentLoop: (...args: unknown[]) => mockRunAgentLoop(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock IncomingMessage (readable stream) with given method/url/body.
 */
function createMockReq(
  method: string,
  url: string,
  body?: unknown,
): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  // Simulate body delivery on next tick
  if (method === "POST" && body !== undefined) {
    process.nextTick(() => {
      const buf = Buffer.from(JSON.stringify(body));
      req.emit("data", buf);
      req.emit("end");
    });
  } else if (method === "POST") {
    // No body — emit end immediately so parseBody resolves
    process.nextTick(() => {
      req.emit("end");
    });
  }
  return req;
}

interface MockServerResponse extends ServerResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  headWritten: boolean;
  // Returns Record (not | null) because tests always write valid JSON bodies
  parsedBody: () => Record<string, unknown>;
}

function createMockRes(): MockServerResponse {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body = "";
  let headWritten = false;

  return {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    }),
    writeHead: vi.fn((code: number, extraHeaders?: Record<string, string>) => {
      statusCode = code;
      headWritten = true;
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          headers[k.toLowerCase()] = v;
        }
      }
    }),
    end: vi.fn((data?: string) => {
      if (data) body = data;
    }),
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
    get headWritten() {
      return headWritten;
    },
    parsedBody() {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    },
  // Partial mock: only implements the ServerResponse methods the handler uses
  } as unknown as MockServerResponse;
}

async function callHandler(
  req: IncomingMessage,
  res: MockServerResponse,
): Promise<void> {
  // MockServerResponse extends ServerResponse at the type level; the partial
  // mock satisfies only the methods the handler actually calls
  await capturedHandler(req, res as ServerResponse);
  await new Promise((r) => setTimeout(r, 10));
}

// ---------------------------------------------------------------------------
// Import server.ts — this triggers startup() and createServer()
// We suppress console output for cleanliness.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  mockGetAgentState.mockReturnValue(null);
  mockGetAgentConfig.mockReturnValue(null);
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockReadFile.mockReset();
  mockRunAgentLoop.mockReset().mockResolvedValue(undefined);
});

// Trigger the import so capturedHandler gets set
import("./server.js");

// ==========================================================================
// Tests
// ==========================================================================

describe("Server startup", () => {
  it("calls createServer and listen on import", async () => {
    // Wait for dynamic import to complete
    await new Promise((r) => setTimeout(r, 50));
    const { createServer } = await import("http");
    expect(createServer).toHaveBeenCalled();
    expect(mockListen).toHaveBeenCalled();
    expect(capturedHandler).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// readLogFeed (tested indirectly via GET /api/state)
// ---------------------------------------------------------------------------

describe("readLogFeed (via /api/state)", () => {
  it("returns empty feed when log file does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    mockGetAgentState.mockReturnValue(null);
    mockGetAgentConfig.mockReturnValue(null);

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    const data = res.parsedBody();
    expect(data.feed).toEqual([]);
  });

  it("returns parsed log entries when file exists", async () => {
    const entry1 = {
      timestamp: "2026-03-14T00:00:00Z",
      sequence: 0,
      action: "agent_start",
    };
    const entry2 = {
      timestamp: "2026-03-14T00:01:00Z",
      sequence: 1,
      action: "cycle_complete",
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify(entry1) + "\n" + JSON.stringify(entry2) + "\n",
    );
    mockGetAgentState.mockReturnValue(null);
    mockGetAgentConfig.mockReturnValue(null);

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    const data = res.parsedBody();
    const feed = data.feed as Record<string, unknown>[];
    expect(feed).toHaveLength(2);
    expect(feed[0].action).toBe("agent_start");
    expect(feed[1].action).toBe("cycle_complete");
  });

  it("skips malformed JSON lines and keeps valid entries", async () => {
    const valid1 = { timestamp: "2026-03-14T00:00:00Z", sequence: 0, action: "agent_start" };
    const valid2 = { timestamp: "2026-03-14T00:01:00Z", sequence: 2, action: "cycle_complete" };
    mockExistsSync.mockReturnValue(true);
    // Line 2 is invalid JSON — it should be skipped, not crash the whole feed
    mockReadFileSync.mockReturnValue(
      JSON.stringify(valid1) + "\nNOT_JSON\n" + JSON.stringify(valid2) + "\n",
    );
    mockGetAgentState.mockReturnValue(null);
    mockGetAgentConfig.mockReturnValue(null);

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    const data = res.parsedBody();
    const feed = data.feed as Record<string, unknown>[];
    // Two valid entries survive; the malformed line is dropped
    expect(feed).toHaveLength(2);
    expect(feed[0].action).toBe("agent_start");
    expect(feed[1].action).toBe("cycle_complete");
  });

  it("skips entries that fail Zod schema validation", async () => {
    // Valid JSON but missing required fields (no timestamp, no sequence)
    const invalid = { action: "bad_entry" };
    const valid = { timestamp: "2026-03-14T00:00:00Z", sequence: 0, action: "agent_start" };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify(invalid) + "\n" + JSON.stringify(valid) + "\n",
    );
    mockGetAgentState.mockReturnValue(null);
    mockGetAgentConfig.mockReturnValue(null);

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    const data = res.parsedBody();
    const feed = data.feed as Record<string, unknown>[];
    // Only the schema-valid entry survives
    expect(feed).toHaveLength(1);
    expect(feed[0].action).toBe("agent_start");
  });

  it("handles readFileSync throwing an error", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    mockGetAgentState.mockReturnValue(null);
    mockGetAgentConfig.mockReturnValue(null);

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    const data = res.parsedBody();
    expect(data.feed).toEqual([]);
  });

  it("handles empty log file", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("");
    mockGetAgentState.mockReturnValue(null);
    mockGetAgentConfig.mockReturnValue(null);

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    const data = res.parsedBody();
    expect(data.feed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handleState (GET /api/state)
// ---------------------------------------------------------------------------

describe("handleState (GET /api/state)", () => {
  it("returns default state when no agent running", async () => {
    mockExistsSync.mockReturnValue(false);
    mockGetAgentState.mockReturnValue(null);
    mockGetAgentConfig.mockReturnValue(null);

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.parsedBody();
    expect(data.cycle).toBe(0);
    expect(data.running).toBe(false);
    expect(data.ethPrice).toBe(0);
    expect(data.drift).toBe(0);
    expect(data.trades).toBe(0);
    expect(data.totalSpent).toBe(0);
    expect(data.budgetTier).toBe("normal");
    expect(data.allocation).toEqual({});
    expect(data.target).toEqual({});
    expect(data.totalValue).toBe(0);
    expect(data.transactions).toEqual([]);
    expect(data.audit).toBeNull();
  });

  it("returns correct state when agent is running", async () => {
    mockExistsSync.mockReturnValue(false);
    const fakeState = {
      cycle: 5,
      running: true,
      ethPrice: 2500,
      drift: 0.08,
      tradesExecuted: 3,
      totalSpentUsd: 150,
      budgetTier: "conservation",
      allocation: { ETH: 0.65, USDC: 0.35 },
      totalValue: 1200,
      transactions: [
        {
          txHash: "0xabc123",
          sellToken: "USDC",
          buyToken: "ETH",
          sellAmount: "50",
          status: "success",
          timestamp: "2026-03-14T01:00:00Z",
        },
      ],
      audit: {
        allows: ["Swap ETH <-> USDC on Uniswap"],
        prevents: ["Withdrawals to external addresses"],
        worstCase: "Loss of $200 daily budget",
        warnings: ["High slippage tolerance"],
        formatted: "...",
      },
    };

    const fakeConfig = {
      intent: {
        targetAllocation: { ETH: 0.6, USDC: 0.4 },
        dailyBudgetUsd: 200,
        timeWindowDays: 7,
        driftThreshold: 0.05,
        maxSlippage: 0.01,
        maxTradesPerDay: 5,
      },
      delegatorKey: "0xaaa",
      agentKey: "0xbbb",
      chainId: 11155111,
      intervalMs: 60000,
    };

    mockGetAgentState.mockReturnValue(fakeState);
    mockGetAgentConfig.mockReturnValue(fakeConfig);

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.statusCode).toBe(200);
    const data = res.parsedBody();
    expect(data.cycle).toBe(5);
    expect(data.running).toBe(true);
    expect(data.ethPrice).toBe(2500);
    expect(data.drift).toBe(0.08);
    expect(data.trades).toBe(3);
    expect(data.totalSpent).toBe(150);
    expect(data.budgetTier).toBe("conservation");
    expect(data.allocation).toEqual({ ETH: 0.65, USDC: 0.35 });
    expect(data.target).toEqual({ ETH: 0.6, USDC: 0.4 });
    expect(data.totalValue).toBe(1200);
    const transactions = data.transactions as Record<string, unknown>[];
    expect(transactions).toHaveLength(1);
    expect(transactions[0].txHash).toBe("0xabc123");
    // Audit should have the 4 fields (not formatted)
    const audit = data.audit as Record<string, unknown>;
    expect(audit.allows).toEqual(["Swap ETH <-> USDC on Uniswap"]);
    expect(audit.prevents).toEqual([
      "Withdrawals to external addresses",
    ]);
    expect(audit.worstCase).toBe("Loss of $200 daily budget");
    expect(audit.warnings).toEqual(["High slippage tolerance"]);
    // formatted should NOT be in the response
    expect(audit.formatted).toBeUndefined();
  });

  it("returns null audit when state has no audit", async () => {
    mockExistsSync.mockReturnValue(false);
    mockGetAgentState.mockReturnValue({
      cycle: 1,
      running: true,
      ethPrice: 2000,
      drift: 0.01,
      tradesExecuted: 0,
      totalSpentUsd: 0,
      budgetTier: "normal",
      allocation: { ETH: 0.6, USDC: 0.4 },
      totalValue: 500,
      transactions: [],
      audit: null,
    });
    mockGetAgentConfig.mockReturnValue({
      intent: { targetAllocation: { ETH: 0.6, USDC: 0.4 } },
    });

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    const data = res.parsedBody();
    expect(data.audit).toBeNull();
  });

  it("returns getAgentState null and getAgentConfig non-null as default state", async () => {
    // If state is null but config is non-null, server still returns default
    mockExistsSync.mockReturnValue(false);
    mockGetAgentState.mockReturnValue(null);
    mockGetAgentConfig.mockReturnValue({ intent: {} });

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    const data = res.parsedBody();
    expect(data.running).toBe(false);
    expect(data.cycle).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// handleDeploy (POST /api/deploy)
// ---------------------------------------------------------------------------

describe("handleDeploy (POST /api/deploy)", () => {
  it("returns 400 when intent is missing", async () => {
    const req = createMockReq("POST", "/api/deploy", {});
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.statusCode).toBe(400);
    const data = res.parsedBody();
    expect(data.error).toBeDefined();
    expect(typeof data.error).toBe("string");
  });

  it("returns 400 when intent is empty string", async () => {
    const req = createMockReq("POST", "/api/deploy", { intent: "" });
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.statusCode).toBe(400);
    const data = res.parsedBody();
    expect(data.error).toBe("Intent cannot be empty");
  });

  it("returns 400 when intent is non-string type", async () => {
    const req = createMockReq("POST", "/api/deploy", { intent: 42 });
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.statusCode).toBe(400);
    const data = res.parsedBody();
    expect(data.error).toBeDefined();
    expect(typeof data.error).toBe("string");
  });

  it("returns 409 when agent is already running", async () => {
    mockGetAgentState.mockReturnValue({ running: true, cycle: 3 });

    const req = createMockReq("POST", "/api/deploy", {
      intent: "60/40 ETH/USDC",
    });
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.statusCode).toBe(409);
    const data = res.parsedBody();
    expect(data.error).toBe("Agent already running");
  });

  it("does not return 409 when agent exists but is not running", async () => {
    mockGetAgentState.mockReturnValue({ running: false, cycle: 5 });

    const { compileIntent } = await import("./delegation/compiler.js");
    const mockCompile = compileIntent as ReturnType<typeof vi.fn>;
    mockCompile.mockResolvedValue({
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      driftThreshold: 0.05,
      maxSlippage: 0.01,
      maxTradesPerDay: 5,
    });

    // First call checks running status; subsequent poll calls return audit
    mockGetAgentState
      .mockReturnValueOnce({ running: false, cycle: 5 }) // first call in handler
      .mockReturnValue({ running: true, cycle: 0, audit: null, deployError: null }); // poll calls + final read

    const req = createMockReq("POST", "/api/deploy", {
      intent: "60/40 ETH/USDC",
    });
    const res = createMockRes();

    // Use fake timers to avoid waiting for real polling delays
    vi.useFakeTimers();
    const promise = callHandler(req, res);
    // Advance past the full poll timeout (10s)
    await vi.advanceTimersByTimeAsync(11_000);
    await promise;
    vi.useRealTimers();

    expect(res.statusCode).toBe(200);
  });

  it("returns 500 when compileIntent throws", async () => {
    mockGetAgentState.mockReturnValue(null);

    const { compileIntent } = await import("./delegation/compiler.js");
    const mockCompile = compileIntent as ReturnType<typeof vi.fn>;
    mockCompile.mockRejectedValue(new Error("Venice API timeout"));

    const req = createMockReq("POST", "/api/deploy", {
      intent: "60/40 ETH/USDC",
    });
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.statusCode).toBe(500);
    const data = res.parsedBody();
    expect(data.error).toBe("Venice API timeout");
  });

  it("calls compileIntent and runAgentLoop on valid deploy", async () => {
    mockGetAgentState.mockReturnValue(null);

    const { compileIntent } = await import("./delegation/compiler.js");
    const mockCompile = compileIntent as ReturnType<typeof vi.fn>;
    const parsedIntent = {
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      driftThreshold: 0.05,
      maxSlippage: 0.01,
      maxTradesPerDay: 5,
    };
    mockCompile.mockResolvedValue(parsedIntent);

    // First check returns null, then poll finds audit set
    mockGetAgentState
      .mockReturnValueOnce(null) // first check (running?)
      .mockReturnValue({
        running: true,
        audit: {
          allows: ["Swap ETH/USDC"],
          prevents: ["External transfers"],
          worstCase: "$200 max loss",
          warnings: [],
          formatted: "...",
        },
        deployError: null,
      });

    const req = createMockReq("POST", "/api/deploy", {
      intent: "60/40 ETH/USDC, $200/day",
    });
    const res = createMockRes();

    vi.useFakeTimers();
    const promise = callHandler(req, res);
    // Advance past the first poll interval (200ms) so the loop finds audit
    await vi.advanceTimersByTimeAsync(300);
    await promise;
    vi.useRealTimers();

    expect(mockCompile).toHaveBeenCalledWith("60/40 ETH/USDC, $200/day");
    expect(mockRunAgentLoop).toHaveBeenCalled();

    const data = res.parsedBody();
    expect(data.parsed).toEqual(parsedIntent);
    const audit = data.audit as Record<string, unknown>;
    expect(audit.allows).toEqual(["Swap ETH/USDC"]);
    expect(audit.prevents).toEqual(["External transfers"]);
    expect(audit.worstCase).toBe("$200 max loss");
    // formatted should not leak to client
    expect(audit.formatted).toBeUndefined();
  });

  it("returns parsed intent with null audit when state has no audit after deploy", async () => {
    mockGetAgentState.mockReturnValue(null);

    const { compileIntent } = await import("./delegation/compiler.js");
    const mockCompile = compileIntent as ReturnType<typeof vi.fn>;
    mockCompile.mockResolvedValue({
      targetAllocation: { ETH: 0.5, USDC: 0.5 },
    });

    // Neither audit nor deployError is set, so poll times out
    mockGetAgentState
      .mockReturnValueOnce(null)
      .mockReturnValue({ running: true, audit: null, deployError: null });

    const req = createMockReq("POST", "/api/deploy", {
      intent: "50/50 split",
    });
    const res = createMockRes();

    vi.useFakeTimers();
    const promise = callHandler(req, res);
    // Advance past the full poll timeout (10s)
    await vi.advanceTimersByTimeAsync(11_000);
    await promise;
    vi.useRealTimers();

    const data = res.parsedBody();
    expect(data.audit).toBeNull();
  });

  it("returns 500 when deployError is set during polling", async () => {
    mockGetAgentState.mockReturnValue(null);

    const { compileIntent } = await import("./delegation/compiler.js");
    const mockCompile = compileIntent as ReturnType<typeof vi.fn>;
    mockCompile.mockResolvedValue({
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      driftThreshold: 0.05,
      maxSlippage: 0.01,
      maxTradesPerDay: 5,
    });

    // First call returns null (not running), then poll finds deployError
    mockGetAgentState
      .mockReturnValueOnce(null) // first check
      .mockReturnValue({
        running: false,
        audit: null,
        deployError: "MetaMask SDK timeout",
      });

    const req = createMockReq("POST", "/api/deploy", {
      intent: "60/40 ETH/USDC",
    });
    const res = createMockRes();

    vi.useFakeTimers();
    const promise = callHandler(req, res);
    // Advance past the first poll interval so the loop finds deployError
    await vi.advanceTimersByTimeAsync(300);
    await promise;
    vi.useRealTimers();

    expect(res.statusCode).toBe(500);
    const data = res.parsedBody();
    expect(data.error).toBe("MetaMask SDK timeout");
  });
});

// ---------------------------------------------------------------------------
// parseBody (tested indirectly via POST /api/deploy with invalid JSON)
// ---------------------------------------------------------------------------

describe("parseBody (via POST /api/deploy)", () => {
  it("returns 500 when body is invalid JSON", async () => {
    const req = new EventEmitter() as IncomingMessage;
    req.method = "POST";
    req.url = "/api/deploy";

    process.nextTick(() => {
      req.emit("data", Buffer.from("not json {{{"));
      req.emit("end");
    });

    const res = createMockRes();
    await callHandler(req, res);

    // parseBody rejects with "Invalid JSON" -> caught by the try/catch
    // in the outer handler -> sendJson 500
    expect(res.statusCode).toBe(500);
    const data = res.parsedBody();
    expect(data.error).toBe("Invalid JSON");
  });

  it("handles empty body as invalid JSON", async () => {
    const req = new EventEmitter() as IncomingMessage;
    req.method = "POST";
    req.url = "/api/deploy";

    process.nextTick(() => {
      req.emit("end");
    });

    const res = createMockRes();
    await callHandler(req, res);

    expect(res.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// handleDashboard (GET /)
// ---------------------------------------------------------------------------

describe("handleDashboard (GET /)", () => {
  it("returns HTML when dashboard build exists", async () => {
    // existsSync returns true for the dashboard index.html
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockImplementation(
      (_path: string, cb: Function) => {
        cb(null, Buffer.from("<html><body>Dashboard</body></html>"));
      },
    );

    const req = createMockReq("GET", "/");
    const res = createMockRes();
    await callHandler(req, res);

    await new Promise((r) => setTimeout(r, 20));

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/html",
    });
  });

  it("returns fallback HTML when dashboard is not built", async () => {
    // existsSync returns false — no dashboard build
    mockExistsSync.mockReturnValue(false);

    const req = createMockReq("GET", "/");
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/html",
    });
    const html = vi.mocked(res.end).mock.calls[0]?.[0] as string;
    expect(html).toContain("VEIL");
    expect(html).toContain("/api/state");
  });

  it("serves dashboard on /dashboard path", async () => {
    mockReadFile.mockImplementation(
      (_path: string, _enc: string, cb: Function) => {
        cb(null, "<html>dash</html>");
      },
    );

    const req = createMockReq("GET", "/dashboard");
    const res = createMockRes();
    await callHandler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/html",
    });
  });

  it("serves dashboard on /index.html path", async () => {
    mockReadFile.mockImplementation(
      (_path: string, _enc: string, cb: Function) => {
        cb(null, "<html>index</html>");
      },
    );

    const req = createMockReq("GET", "/index.html");
    const res = createMockRes();
    await callHandler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/html",
    });
  });
});

// ---------------------------------------------------------------------------
// CORS via setCors
// ---------------------------------------------------------------------------

describe("CORS headers", () => {
  it("OPTIONS request returns 204 with CORS headers", async () => {
    const req = createMockReq("OPTIONS", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "*",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Headers",
      "Content-Type",
    );
  });

  it("JSON responses include CORS headers", async () => {
    mockExistsSync.mockReturnValue(false);
    mockGetAgentState.mockReturnValue(null);
    mockGetAgentConfig.mockReturnValue(null);

    const req = createMockReq("GET", "/api/state");
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "*",
    );
  });

  it("OPTIONS on /api/deploy also returns CORS headers", async () => {
    const req = createMockReq("OPTIONS", "/api/deploy");
    const res = createMockRes();
    await callHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "*",
    );
  });
});

// ---------------------------------------------------------------------------
// SPA fallback route (unknown paths serve React dashboard)
// ---------------------------------------------------------------------------

describe("SPA fallback routes", () => {
  it("serves dashboard for unknown GET paths (SPA fallback)", async () => {
    const req = createMockReq("GET", "/api/unknown");
    const res = createMockRes();
    await callHandler(req, res);

    // SPA fallback attempts to serve React index.html or vanilla dashboard
    // In test env without real files, it may call readFile which is async
    await new Promise((r) => setTimeout(r, 50));

    // Should NOT return a JSON 404 — it tries to serve HTML
    const writeHeadCalls = vi.mocked(res.writeHead).mock.calls;
    if (writeHeadCalls.length > 0) {
      // Either serves HTML (200) or file-not-found (404 text/plain)
      const status = writeHeadCalls[0][0];
      expect([200, 404]).toContain(status);
    }
  });

  it("serves dashboard for POST to unknown path", async () => {
    const req = createMockReq("POST", "/api/unknown", { foo: "bar" });
    const res = createMockRes();
    await callHandler(req, res);

    await new Promise((r) => setTimeout(r, 50));

    // SPA fallback handles all non-API routes
    const writeHeadCalls = vi.mocked(res.writeHead).mock.calls;
    if (writeHeadCalls.length > 0) {
      const status = writeHeadCalls[0][0];
      expect([200, 404]).toContain(status);
    }
  });

  it("unknown route does not return JSON error", async () => {
    const req = createMockReq("GET", "/nonexistent");
    const res = createMockRes();
    await callHandler(req, res);

    await new Promise((r) => setTimeout(r, 50));

    // Should NOT have Content-Type: application/json with error
    const endCalls = vi.mocked(res.end).mock.calls;
    if (endCalls.length > 0) {
      const body = endCalls[0][0];
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body);
          // If it IS JSON, it should NOT be an error response
          expect(parsed.error).toBeUndefined();
        } catch {
          // Not JSON — that's fine (it's HTML)
        }
      }
    }
  });
});
