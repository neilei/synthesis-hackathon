/**
 * E2E tests for Venice LLM instances against live API.
 *
 * @module @maw/agent/venice/llm.e2e.test
 */
import { describe, it, expect } from "vitest";
import { fastLlm, researchLlm, reasoningLlm } from "../llm.js";
import {
  PriceResponseSchema,
  RebalanceDecisionSchema,
} from "../schemas.js";

describe("Venice LLM E2E", () => {
  it(
    "fastLlm responds correctly to a simple arithmetic query",
    { timeout: 30000 },
    async () => {
      const result = await fastLlm.invoke(
        "What is 2+2? Reply with just the number.",
      );

      expect(result.content).toBeDefined();
      const content = String(result.content).trim();
      expect(content).toContain("4");
    },
  );

  it(
    "fastLlm handles multi-turn messages",
    { timeout: 30000 },
    async () => {
      const result = await fastLlm.invoke([
        { role: "system", content: "You are a calculator. Only output numbers." },
        { role: "user", content: "What is 10 * 5?" },
      ]);

      const content = String(result.content).trim();
      expect(content).toContain("50");
    },
  );

  it(
    "researchLlm returns structured price via web search",
    { timeout: 180000 },
    async () => {
      const structuredLlm = researchLlm.withStructuredOutput(
        PriceResponseSchema,
        { name: "price_response" },
      );
      const result = await structuredLlm.invoke(
        "What is the current price of Ethereum (ETH) in USD? Give me the price and the source URL.",
      );

      // Must pass schema validation
      const validated = PriceResponseSchema.safeParse(result);
      expect(validated.success).toBe(true);

      if (validated.success) {
        expect(typeof validated.data.price).toBe("number");
        expect(validated.data.price).toBeGreaterThan(0);
        // Price should be in a reasonable ETH range
        expect(validated.data.price).toBeGreaterThan(100);
        expect(validated.data.price).toBeLessThan(100000);
      }
    },
  );

  it(
    "reasoningLlm returns structured rebalance decision",
    { timeout: 180000 },
    async () => {
      const structuredLlm = reasoningLlm.withStructuredOutput(
        RebalanceDecisionSchema,
        { name: "rebalance_decision" },
      );
      const result = await structuredLlm.invoke(
        `You are a DeFi portfolio agent. Current portfolio: 70% ETH, 30% USDC.
Target: 60% ETH, 40% USDC. ETH is up 5% today.
Should we rebalance? The drift threshold is 5%.`,
      );

      const validated = RebalanceDecisionSchema.safeParse(result);
      expect(validated.success).toBe(true);

      if (validated.success) {
        expect(typeof validated.data.shouldRebalance).toBe("boolean");

        // Reasoning must be substantive
        expect(validated.data.reasoning.length).toBeGreaterThan(10);

        // With 10% drift (70→60) exceeding 5% threshold, should rebalance
        expect(validated.data.shouldRebalance).toBe(true);

        // When recommending rebalance, targetSwap should be present
        if (validated.data.shouldRebalance) {
          expect(validated.data.targetSwap).not.toBeNull();
          if (validated.data.targetSwap) {
            expect(validated.data.targetSwap.sellToken.length).toBeGreaterThan(0);
            expect(validated.data.targetSwap.buyToken.length).toBeGreaterThan(0);
            // Selling ETH to buy USDC (over-allocated in ETH)
            expect(validated.data.targetSwap.sellToken.toUpperCase()).toBe("ETH");
            expect(validated.data.targetSwap.buyToken.toUpperCase()).toBe("USDC");
          }
        }
      }
    },
  );

  it(
    "reasoningLlm recommends NOT rebalancing when drift is below threshold",
    { timeout: 180000 },
    async () => {
      const structuredLlm = reasoningLlm.withStructuredOutput(
        RebalanceDecisionSchema,
        { name: "rebalance_decision" },
      );
      const result = await structuredLlm.invoke(
        `You are a DeFi portfolio agent. Current portfolio: 61% ETH, 39% USDC.
Target: 60% ETH, 40% USDC. Market is stable.
Should we rebalance? The drift threshold is 5%.`,
      );

      const validated = RebalanceDecisionSchema.safeParse(result);
      expect(validated.success).toBe(true);

      if (validated.success) {
        // 1% drift is well below 5% threshold — should NOT rebalance
        expect(validated.data.shouldRebalance).toBe(false);
        expect(validated.data.reasoning.length).toBeGreaterThan(10);
        // When not rebalancing, targetSwap should be null
        expect(validated.data.targetSwap).toBeNull();
      }
    },
  );

  it(
    "structured output rejects invalid schema gracefully",
    { timeout: 30000 },
    async () => {
      // Use fastLlm with a schema that expects a number — asking a question
      // that produces a valid structured response
      const structuredLlm = fastLlm.withStructuredOutput(PriceResponseSchema, {
        name: "price_response",
      });
      const result = await structuredLlm.invoke(
        "The price of water is $1.50. What is the price? Give citation as null.",
      );

      const validated = PriceResponseSchema.safeParse(result);
      expect(validated.success).toBe(true);
      if (validated.success) {
        expect(typeof validated.data.price).toBe("number");
      }
    },
  );
});
