/**
 * Unit tests for Zod schema validation of LLM structured outputs.
 *
 * @module @veil/agent/venice/schemas.test
 */
import { describe, it, expect } from "vitest";
import {
  IntentParseSchema,
  RebalanceDecisionSchema,
  MarketAnalysisSchema,
  PriceResponseSchema,
} from "./schemas.js";

describe("IntentParseSchema", () => {
  it("accepts valid intent", () => {
    const result = IntentParseSchema.safeParse({
      targetAllocation: { ETH: 0.6, USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 10,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing targetAllocation", () => {
    const result = IntentParseSchema.safeParse({
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 10,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric allocation values", () => {
    const result = IntentParseSchema.safeParse({
      targetAllocation: { ETH: "sixty", USDC: 0.4 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 10,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(result.success).toBe(false);
  });

  it("accepts single-token allocation", () => {
    const result = IntentParseSchema.safeParse({
      targetAllocation: { ETH: 1.0 },
      dailyBudgetUsd: 100,
      timeWindowDays: 30,
      maxTradesPerDay: 5,
      maxSlippage: 0.01,
      driftThreshold: 0.1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects allocation summing to 0.8 (too low)", () => {
    const result = IntentParseSchema.safeParse({
      targetAllocation: { ETH: 0.5, USDC: 0.3 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 10,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(result.success).toBe(false);
  });

  it("rejects allocation summing to 1.2 (too high)", () => {
    const result = IntentParseSchema.safeParse({
      targetAllocation: { ETH: 0.7, USDC: 0.5 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 10,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(result.success).toBe(false);
  });

  it("accepts allocation summing to 0.99 (floating point edge)", () => {
    const result = IntentParseSchema.safeParse({
      targetAllocation: { ETH: 0.33, USDC: 0.33, WBTC: 0.33 },
      dailyBudgetUsd: 200,
      timeWindowDays: 7,
      maxTradesPerDay: 10,
      maxSlippage: 0.005,
      driftThreshold: 0.05,
    });
    expect(result.success).toBe(true);
  });
});

describe("RebalanceDecisionSchema", () => {
  it("accepts decision with swap", () => {
    const result = RebalanceDecisionSchema.safeParse({
      shouldRebalance: true,
      reasoning: "ETH allocation drifted 10% above target",
      marketContext: "ETH up 5% today",
      targetSwap: {
        sellToken: "ETH",
        buyToken: "USDC",
        sellAmount: "0.05",
        maxSlippage: "0.005",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts decision without swap (no rebalance)", () => {
    const result = RebalanceDecisionSchema.safeParse({
      shouldRebalance: false,
      reasoning: "Drift within threshold",
      marketContext: null,
      targetSwap: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts null marketContext and targetSwap", () => {
    const result = RebalanceDecisionSchema.safeParse({
      shouldRebalance: false,
      reasoning: "No action needed",
      marketContext: null,
      targetSwap: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.marketContext).toBeNull();
      expect(result.data.targetSwap).toBeNull();
    }
  });

  it("rejects missing reasoning", () => {
    const result = RebalanceDecisionSchema.safeParse({
      shouldRebalance: true,
      marketContext: null,
      targetSwap: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects swap with missing fields", () => {
    const result = RebalanceDecisionSchema.safeParse({
      shouldRebalance: true,
      reasoning: "Need to rebalance",
      marketContext: null,
      targetSwap: {
        sellToken: "ETH",
        // missing buyToken, sellAmount, maxSlippage
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("MarketAnalysisSchema", () => {
  it("accepts full market analysis", () => {
    const result = MarketAnalysisSchema.safeParse({
      ethPriceUsd: 2100.5,
      usdcPriceUsd: 1.0,
      ethChange24h: 5.2,
      marketSentiment: "bullish",
      citation: "https://coindesk.com/price/ethereum",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null optional fields", () => {
    const result = MarketAnalysisSchema.safeParse({
      ethPriceUsd: 2100.5,
      usdcPriceUsd: 1.0,
      ethChange24h: null,
      marketSentiment: "neutral",
      citation: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid sentiment value", () => {
    const result = MarketAnalysisSchema.safeParse({
      ethPriceUsd: 2100.5,
      usdcPriceUsd: 1.0,
      ethChange24h: null,
      marketSentiment: "sideways",
      citation: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("PriceResponseSchema", () => {
  it("accepts price with citation", () => {
    const result = PriceResponseSchema.safeParse({
      price: 2100.5,
      citation: "https://coingecko.com",
    });
    expect(result.success).toBe(true);
  });

  it("accepts price with null citation", () => {
    const result = PriceResponseSchema.safeParse({
      price: 2100.5,
      citation: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-numeric price", () => {
    const result = PriceResponseSchema.safeParse({
      price: "two thousand",
      citation: null,
    });
    expect(result.success).toBe(false);
  });
});
