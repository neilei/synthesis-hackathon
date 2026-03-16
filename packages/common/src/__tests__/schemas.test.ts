/**
 * @file Tests for Zod schemas — ParsedIntent, SwapRecord, AuditReport,
 * AgentLogEntry, AgentStateResponse, DeployResponse.
 */
import { describe, it, expect } from "vitest";
import {
  ParsedIntentSchema,
  SwapRecordSchema,
  AuditReportSchema,
  AgentLogEntrySchema,
  AgentStateResponseSchema,
  DeployResponseSchema,
  DeployRequestSchema,
  type ParsedIntent,
  type SwapRecord,
  type AuditReport,
  type AgentLogEntry,
  type AgentStateResponse,
  type DeployResponse,
} from "../schemas.js";

// ---------------------------------------------------------------------------
// ParsedIntentSchema
// ---------------------------------------------------------------------------

describe("ParsedIntentSchema", () => {
  const valid: ParsedIntent = {
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    timeWindowDays: 7,
    maxTradesPerDay: 5,
    maxSlippage: 0.005,
    driftThreshold: 0.05,
  };

  it("accepts a valid parsed intent", () => {
    const result = ParsedIntentSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects missing targetAllocation", () => {
    const { targetAllocation: _, ...rest } = valid;
    const result = ParsedIntentSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing dailyBudgetUsd", () => {
    const { dailyBudgetUsd: _, ...rest } = valid;
    const result = ParsedIntentSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects non-number values in targetAllocation", () => {
    const result = ParsedIntentSchema.safeParse({
      ...valid,
      targetAllocation: { ETH: "sixty" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SwapRecordSchema
// ---------------------------------------------------------------------------

describe("SwapRecordSchema", () => {
  const valid: SwapRecord = {
    txHash: "0xabc123",
    sellToken: "ETH",
    buyToken: "USDC",
    sellAmount: "0.1",
    status: "confirmed",
    timestamp: "2026-03-15T12:00:00.000Z",
  };

  it("accepts a valid swap record", () => {
    const result = SwapRecordSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects missing txHash", () => {
    const { txHash: _, ...rest } = valid;
    const result = SwapRecordSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing sellToken", () => {
    const { sellToken: _, ...rest } = valid;
    const result = SwapRecordSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AuditReportSchema
// ---------------------------------------------------------------------------

describe("AuditReportSchema", () => {
  const valid: AuditReport = {
    allows: ["Swap ETH for USDC on Uniswap V3"],
    prevents: ["Withdrawals to external addresses"],
    worstCase: "Agent could spend the full daily budget on slippage",
    warnings: ["High gas fees may reduce effective returns"],
  };

  it("accepts a valid audit report", () => {
    const result = AuditReportSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts empty arrays for allows and prevents", () => {
    const result = AuditReportSchema.safeParse({
      ...valid,
      allows: [],
      prevents: [],
      warnings: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing worstCase", () => {
    const { worstCase: _, ...rest } = valid;
    const result = AuditReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects non-string items in allows", () => {
    const result = AuditReportSchema.safeParse({
      ...valid,
      allows: [123],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AgentLogEntrySchema
// ---------------------------------------------------------------------------

describe("AgentLogEntrySchema", () => {
  const minimal: AgentLogEntry = {
    timestamp: "2026-03-15T12:00:00.000Z",
    sequence: 0,
    action: "agent_start",
  };

  const full: AgentLogEntry = {
    timestamp: "2026-03-15T12:00:00.000Z",
    sequence: 1,
    action: "rebalance_check",
    tool: "venice_llm",
    parameters: { model: "qwen3-4b" },
    result: { shouldRebalance: false },
    duration_ms: 1234,
    error: undefined,
  };

  it("accepts a minimal entry (only required fields)", () => {
    const result = AgentLogEntrySchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("accepts a full entry with all optional fields", () => {
    const result = AgentLogEntrySchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it("rejects missing timestamp", () => {
    const { timestamp: _, ...rest } = minimal;
    const result = AgentLogEntrySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing sequence", () => {
    const { sequence: _, ...rest } = minimal;
    const result = AgentLogEntrySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing action", () => {
    const { action: _, ...rest } = minimal;
    const result = AgentLogEntrySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("does NOT have a success field", () => {
    const withSuccess = { ...minimal, success: true };
    const result = AgentLogEntrySchema.safeParse(withSuccess);
    // Zod v4 strips unknown keys by default, so parse should succeed
    // but the parsed data should NOT include success
    if (result.success) {
      expect("success" in result.data).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// AgentStateResponseSchema
// ---------------------------------------------------------------------------

describe("AgentStateResponseSchema", () => {
  const valid: AgentStateResponse = {
    cycle: 5,
    running: true,
    ethPrice: 2500,
    drift: 0.03,
    trades: 2,
    totalSpent: 150.5,
    budgetTier: "$200/day",
    allocation: { ETH: 0.58, USDC: 0.42 },
    target: { ETH: 0.6, USDC: 0.4 },
    totalValue: 1000,
    feed: [
      {
        timestamp: "2026-03-15T12:00:00.000Z",
        sequence: 0,
        action: "agent_start",
      },
    ],
    transactions: [
      {
        txHash: "0xabc",
        sellToken: "ETH",
        buyToken: "USDC",
        sellAmount: "0.1",
        status: "confirmed",
        timestamp: "2026-03-15T12:00:00.000Z",
      },
    ],
    audit: {
      allows: ["Swap"],
      prevents: ["Withdraw"],
      worstCase: "Loss",
      warnings: [],
    },
    deployError: null,
  };

  it("accepts a valid agent state response", () => {
    const result = AgentStateResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts null audit", () => {
    const result = AgentStateResponseSchema.safeParse({
      ...valid,
      audit: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty feed and transactions", () => {
    const result = AgentStateResponseSchema.safeParse({
      ...valid,
      feed: [],
      transactions: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing cycle", () => {
    const { cycle: _, ...rest } = valid;
    const result = AgentStateResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts deployError as a string", () => {
    const result = AgentStateResponseSchema.safeParse({
      ...valid,
      deployError: "MetaMask SDK timeout",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing deployError", () => {
    const { deployError: _, ...rest } = valid;
    const result = AgentStateResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DeployResponseSchema
// ---------------------------------------------------------------------------

describe("DeployResponseSchema", () => {
  const valid: DeployResponse = {
    parsed: {
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 5,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    },
    audit: {
      allows: ["Swap"],
      prevents: ["Withdraw"],
      worstCase: "Loss",
      warnings: [],
    },
  };

  it("accepts a valid deploy response", () => {
    const result = DeployResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts null audit", () => {
    const result = DeployResponseSchema.safeParse({
      ...valid,
      audit: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing parsed", () => {
    const { parsed: _, ...rest } = valid;
    const result = DeployResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DeployRequestSchema
// ---------------------------------------------------------------------------

describe("DeployRequestSchema", () => {
  it("accepts valid deploy request", () => {
    const result = DeployRequestSchema.safeParse({ intent: "60/40 ETH/USDC" });
    expect(result.success).toBe(true);
  });

  it("rejects missing intent", () => {
    const result = DeployRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty intent", () => {
    const result = DeployRequestSchema.safeParse({ intent: "" });
    expect(result.success).toBe(false);
  });

  it("rejects non-string intent", () => {
    const result = DeployRequestSchema.safeParse({ intent: 123 });
    expect(result.success).toBe(false);
  });

  it("returns parsed data with intent field", () => {
    const result = DeployRequestSchema.safeParse({ intent: "80/20 ETH/USDC, $100/day" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe("80/20 ETH/USDC, $100/day");
    }
  });
});
