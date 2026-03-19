/**
 * Zod validation schemas for all LLM structured outputs: intent parsing,
 * rebalance decisions, market analysis, and price responses.
 * Types derived via z.infer to prevent schema/type drift.
 *
 * @module @veil/agent/venice/schemas
 */
import { z } from "zod";
import { ParsedIntentSchema, type ParsedIntent } from "@veil/common";

// Re-export base schema for type derivation
export { ParsedIntentSchema };
export type { ParsedIntent };
export type IntentParse = ParsedIntent;

// Agent-specific validation: wraps the shared schema with allocation sum check.
// This lives here (not in @veil/common) because it's agent business logic.
export const IntentParseSchema = ParsedIntentSchema.refine(
  (data) => {
    const sum = Object.values(data.targetAllocation).reduce((a, b) => a + b, 0);
    return sum >= 0.95 && sum <= 1.05;
  },
  { message: "Target allocation percentages must sum to ~1.0 (within 5% tolerance)" },
);

// Schema sent to the LLM via function calling. Uses an explicit array instead
// of z.record() because Venice/Gemini's function calling drops dynamic keys
// from record-style JSON Schema (the `propertyNames` field Zod 4 emits).
export const IntentParseLlmSchema = z
  .object({
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
    maxPerTradeUsd: z
      .number()
      .describe("Maximum USD value of a single trade. Defaults to the dailyBudgetUsd if not specified."),
    maxSlippage: z
      .number()
      .describe("Maximum slippage as decimal, e.g. 0.005 for 0.5%"),
    driftThreshold: z
      .number()
      .describe(
        "Minimum allocation drift to trigger rebalance, e.g. 0.05 for 5%",
      ),
  })
  .refine(
    (data) => {
      const sum = data.targetAllocation.reduce((a, b) => a + b.percentage, 0);
      return sum >= 0.95 && sum <= 1.05;
    },
    { message: "Target allocation percentages must sum to ~1.0 (within 5% tolerance)" },
  );

export type IntentParseLlm = z.infer<typeof IntentParseLlmSchema>;

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
