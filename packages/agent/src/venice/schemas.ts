/**
 * Zod validation schemas for all LLM structured outputs: intent parsing,
 * rebalance decisions, market analysis, and price responses.
 * Types derived via z.infer to prevent schema/type drift.
 *
 * @module @veil/agent/venice/schemas
 */
import { z } from "zod";

// Schema sent to the LLM via function calling. Uses an explicit array instead
// of z.record() because Venice/Gemini's function calling drops dynamic keys
// from record-style JSON Schema (the `propertyNames` field Zod 4 emits).
export const IntentParseLlmSchema = z.object({
  targetAllocation: z
    .array(
      z.object({
        token: z.string().describe("Token symbol, e.g. ETH, USDC, WBTC"),
        percentage: z
          .number()
          .describe("Target percentage as decimal 0-1, e.g. 0.6 for 60%"),
      }),
    )
    .describe(
      "Target allocation as array of token/percentage pairs that sum to 1.0. e.g. [{ token: 'ETH', percentage: 0.6 }, { token: 'USDC', percentage: 0.4 }]",
    ),
  dailyBudgetUsd: z
    .number()
    .describe("Maximum USD value of trades per day"),
  timeWindowDays: z
    .number()
    .describe("How many days the delegation should last"),
  maxTradesPerDay: z
    .number()
    .describe("Maximum number of trades per day"),
  maxSlippage: z
    .number()
    .describe("Maximum slippage as decimal, e.g. 0.005 for 0.5%"),
  driftThreshold: z
    .number()
    .describe(
      "Minimum allocation drift to trigger rebalance, e.g. 0.05 for 5%",
    ),
});

export type IntentParseLlm = z.infer<typeof IntentParseLlmSchema>;

// Canonical schema used throughout the codebase for validation. Accepts the
// Record<string, number> format that all downstream code expects.
export const IntentParseSchema = z.object({
  targetAllocation: z
    .record(z.string(), z.number())
    .describe(
      "Target allocation as token symbol to percentage (0-1). e.g. { ETH: 0.6, USDC: 0.4 }",
    ),
  dailyBudgetUsd: z
    .number()
    .describe("Maximum USD value of trades per day"),
  timeWindowDays: z
    .number()
    .describe("How many days the delegation should last"),
  maxTradesPerDay: z
    .number()
    .describe("Maximum number of trades per day"),
  maxSlippage: z
    .number()
    .describe("Maximum slippage as decimal, e.g. 0.005 for 0.5%"),
  driftThreshold: z
    .number()
    .describe(
      "Minimum allocation drift to trigger rebalance, e.g. 0.05 for 5%",
    ),
});

export type IntentParse = z.infer<typeof IntentParseSchema>;

export const RebalanceDecisionSchema = z.object({
  shouldRebalance: z
    .boolean()
    .describe("Whether the portfolio should be rebalanced now"),
  reasoning: z
    .string()
    .describe("Brief explanation of the decision"),
  marketContext: z
    .string()
    .nullable()
    .describe("Current market conditions summary, or null if unavailable"),
  targetSwap: z
    .object({
      sellToken: z
        .string()
        .describe("Token symbol to sell, e.g. ETH or USDC"),
      buyToken: z.string().describe("Token symbol to buy"),
      sellAmount: z
        .string()
        .describe("Amount to sell in token units"),
      maxSlippage: z
        .string()
        .describe("Max slippage as decimal, e.g. 0.005 for 0.5%"),
    })
    .nullable()
    .describe("Swap details if shouldRebalance is true, null otherwise"),
});

export type RebalanceDecision = z.infer<typeof RebalanceDecisionSchema>;

export const MarketAnalysisSchema = z.object({
  ethPriceUsd: z.number().describe("Current ETH price in USD"),
  usdcPriceUsd: z.number().describe("Current USDC price in USD (should be ~1)"),
  ethChange24h: z
    .number()
    .nullable()
    .describe("ETH 24h price change percentage, or null if unknown"),
  marketSentiment: z
    .enum(["bullish", "bearish", "neutral"])
    .describe("Overall market sentiment"),
  citation: z
    .string()
    .nullable()
    .describe("Source URL for the price data, or null if unavailable"),
});

export type MarketAnalysis = z.infer<typeof MarketAnalysisSchema>;

export const PriceResponseSchema = z.object({
  price: z.number().describe("Token price in USD"),
  citation: z
    .string()
    .nullable()
    .describe("Source URL for the price data, or null if unavailable"),
});

export type PriceResponse = z.infer<typeof PriceResponseSchema>;
