import { describe, it, expect } from "vitest";
import { buildJudgePrompt } from "../judge.js";
import { getDimensionsForIntent } from "../dimensions.js";
import type { SwapEvidence } from "../evidence.js";

const MOCK_EVIDENCE: SwapEvidence = {
  agentId: 42,
  intentId: "test-intent",
  cycle: 1,
  swapTxHash: "0xabc123",
  intent: {
    targetAllocation: { ETH: 0.6, USDC: 0.4 },
    dailyBudgetUsd: 200,
    driftThreshold: 0.05,
    maxSlippage: 0.005,
    timeWindowDays: 7,
    maxTradesPerDay: 10,
  },
  beforeSwap: { allocation: { ETH: 0.73, USDC: 0.27 }, drift: 0.13, portfolioValueUsd: 1850 },
  afterSwap: { allocation: { ETH: 0.61, USDC: 0.39 }, drift: 0.01, portfolioValueUsd: 1847 },
  execution: {
    sellToken: "ETH",
    buyToken: "USDC",
    sellAmount: "0.05",
    gasUsed: 185000,
    slippage: 0.003,
    viaDelegation: true,
  },
  agentReasoning: "Drift exceeded threshold, selling ETH to rebalance toward 60/40 target",
  marketContext: { ethPriceUsd: 2450, poolTvlUsd: 2100000, pool24hVolume: 890000 },
  timestamp: "2026-03-17T00:00:00Z",
};

describe("judge", () => {
  it("buildJudgePrompt includes all dimension criteria", () => {
    const dims = getDimensionsForIntent("rebalance");
    const { systemPrompt, userPrompt } = buildJudgePrompt(dims, MOCK_EVIDENCE);

    expect(systemPrompt).toContain("independent validator");
    expect(systemPrompt).toContain("DECISION QUALITY");
    expect(systemPrompt).toContain("EXECUTION QUALITY");
    expect(systemPrompt).toContain("GOAL PROGRESS");
    expect(userPrompt).toContain("0xabc123");
    expect(userPrompt).toContain("0.13"); // drift before
  });

  it("buildJudgePrompt includes calibration guidance", () => {
    const dims = getDimensionsForIntent("rebalance");
    const { systemPrompt } = buildJudgePrompt(dims, MOCK_EVIDENCE);

    expect(systemPrompt).toContain("90-100");
    expect(systemPrompt).toContain("0-29");
    expect(systemPrompt).toContain("65-80");
  });

  it("buildJudgePrompt serializes all evidence fields", () => {
    const dims = getDimensionsForIntent("rebalance");
    const { userPrompt } = buildJudgePrompt(dims, MOCK_EVIDENCE);

    // Should include all key evidence sections
    expect(userPrompt).toContain("targetAllocation");
    expect(userPrompt).toContain("beforeSwap");
    expect(userPrompt).toContain("afterSwap");
    expect(userPrompt).toContain("agentReasoning");
    expect(userPrompt).toContain("marketContext");
    expect(userPrompt).toContain("2450"); // ethPriceUsd
  });

  it("buildJudgePrompt works with custom dimensions", () => {
    const customDims = [
      {
        tag: "custom-dim",
        name: "Custom Dimension",
        criteria: "Test criteria for custom dimension",
        weight: 1.0,
      },
    ];
    const { systemPrompt } = buildJudgePrompt(customDims, MOCK_EVIDENCE);

    expect(systemPrompt).toContain("CUSTOM DIMENSION");
    expect(systemPrompt).toContain("Test criteria for custom dimension");
  });
});
