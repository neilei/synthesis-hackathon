/**
 * REFERENCE ONLY — Venice AI + Langchain Patterns
 * Source: adapted from another project's agent config
 *
 * Production-tested patterns for Venice LLM integration via Langchain.
 */

import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import { z } from "zod";

// ============================================================
// Venice LLM Factory
// ============================================================

export const getVeniceLlm = (options: ChatOpenAIFields) => {
  return new ChatOpenAI({
    ...options,
    apiKey: process.env.VENICE_API_KEY,
    configuration: {
      ...options.configuration,
      baseURL: process.env.VENICE_BASE_URL, // https://api.venice.ai/api/v1/
    },
  });
};

// ============================================================
// Venice Parameters — passed via modelKwargs
// ============================================================

// Fast/cheap config (for quick lookups, balance checks)
const fastVeniceParams = {
  venice_parameters: {
    disable_thinking: true,
    enable_web_search: "off" as const,
    enable_web_scraping: false,
    enable_web_citations: false,
    include_search_results_in_stream: false,
    return_search_results_as_documents: false,
    include_venice_system_prompt: false,
  },
};

// Research config (for market analysis, trade decisions)
const researchVeniceParams = {
  venice_parameters: {
    disable_thinking: false,
    enable_web_search: "on" as const,
    enable_web_scraping: false, // Can cause rate limits — enable carefully
    enable_web_citations: true,
    include_search_results_in_stream: true,
    return_search_results_as_documents: false,
    include_venice_system_prompt: false,
  },
};

// ============================================================
// Model Presets (from production usage)
// ============================================================

// Fast: qwen3-4b or qwen3-5-35b-a3b
const fastLlm = getVeniceLlm({
  model: "qwen3-4b",
  temperature: 0.3,
  maxRetries: 1,
  modelKwargs: fastVeniceParams,
  timeout: 60000,
});

// Research: gemini-3-flash-preview (balanced speed/quality)
const researchLlm = getVeniceLlm({
  model: "gemini-3-flash-preview",
  temperature: 0.5,
  maxRetries: 2,
  modelKwargs: researchVeniceParams,
  timeout: 120000,
});

// Complex reasoning: gemini-3-1-pro-preview or kimi-k2-thinking
const reasoningLlm = getVeniceLlm({
  model: "gemini-3-1-pro-preview",
  temperature: 0,
  maxRetries: 2,
  modelKwargs: researchVeniceParams,
  timeout: 300000,
});

// ============================================================
// Structured Output Pattern
// ============================================================

const rebalanceDecisionSchema = z.object({
  shouldRebalance: z.boolean().describe("Whether the portfolio should be rebalanced now"),
  reasoning: z.string().describe("Brief explanation of the decision"),
  targetSwap: z
    .object({
      sellToken: z.string().describe("Token symbol to sell, e.g. ETH or USDC"),
      buyToken: z.string().describe("Token symbol to buy"),
      sellAmount: z.string().describe("Amount to sell in token units"),
      maxSlippage: z.string().describe("Max slippage as decimal, e.g. 0.005 for 0.5%"),
    })
    .optional()
    .describe("Only present if shouldRebalance is true"),
});

type RebalanceDecision = z.infer<typeof rebalanceDecisionSchema>;

// Create structured LLM
const structuredLlm = reasoningLlm.withStructuredOutput<RebalanceDecision>(
  rebalanceDecisionSchema,
  { name: "rebalance_decision" }
);

// Invoke and validate
async function getRebalanceDecision(messages: any[]) {
  const result = await structuredLlm.invoke(messages, {
    maxConcurrency: 3,
    timeout: 300000,
  });

  // Always post-validate — Venice structured output is ~99% reliable
  const validated = rebalanceDecisionSchema.safeParse(result);
  if (!validated.success) {
    throw new Error(`Venice structured output validation failed: ${validated.error}`);
  }
  return validated.data;
}
