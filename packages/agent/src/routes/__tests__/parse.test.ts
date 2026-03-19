import { describe, it, expect, vi, beforeEach } from "vitest";
import { createParseRoutes } from "../parse.js";

vi.mock("../../delegation/compiler.js", () => ({
  compileIntent: vi.fn(),
}));
vi.mock("@veil/common", async () => {
  const actual = await vi.importActual<typeof import("@veil/common")>(
    "@veil/common",
  );
  return {
    ...actual,
    generateAuditReport: vi.fn().mockReturnValue({
      allows: ["swap ETH for USDC"],
      prevents: ["exceed $200/day"],
      worstCase: "$200 in slippage",
      warnings: [],
    }),
  };
});
vi.mock("../../logging/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { compileIntent } from "../../delegation/compiler.js";
const mockCompile = vi.mocked(compileIntent);

describe("parse-intent routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed intent and audit report", async () => {
    mockCompile.mockResolvedValue({
      targetAllocation: { ETH: 60, USDC: 40 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 5,
      maxPerTradeUsd: 200,
      maxSlippage: 0.5,
      driftThreshold: 5,
    });

    const app = createParseRoutes();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "60/40 ETH/USDC, $200/day, 7 days" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parsed.dailyBudgetUsd).toBe(200);
    expect(body.audit.allows).toContain("swap ETH for USDC");
  });

  it("returns 400 when intent text is missing", async () => {
    const app = createParseRoutes();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing intent text");
  });

  it("returns 400 when intent is empty string", async () => {
    const app = createParseRoutes();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 500 when compileIntent throws", async () => {
    mockCompile.mockRejectedValue(new Error("LLM timeout"));

    const app = createParseRoutes();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "some intent" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("LLM timeout");
  });
});
