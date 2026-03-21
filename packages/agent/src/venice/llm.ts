/**
 * Venice AI LLM instances via LangChain. Three tiers: fast (qwen3-5-9b),
 * research (qwen3-5-9b with web search), reasoning (gemini-3-flash-preview).
 * Custom fetch wrapper captures billing headers for budget tracking.
 *
 * @module @maw/agent/venice/llm
 */
import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import { env } from "../config.js";
import { updateBudget } from "../logging/budget.js";

// LLM timeout constants (milliseconds)
const LLM_TIMEOUT_FAST_MS = 60_000;
const LLM_TIMEOUT_RESEARCH_MS = 120_000;
const LLM_TIMEOUT_REASONING_MS = 300_000;

/** Token usage from a single LLM call (from AIMessage.usage_metadata). */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Custom fetch that captures Venice billing headers
const veniceFetch: typeof globalThis.fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  const balanceUsd = response.headers.get("x-venice-balance-usd");
  if (balanceUsd) {
    updateBudget({ "x-venice-balance-usd": balanceUsd });
  }
  return response;
};

export const getVeniceLlm = (options: ChatOpenAIFields) => {
  return new ChatOpenAI({
    ...options,
    apiKey: env.VENICE_API_KEY,
    configuration: {
      ...options.configuration,
      baseURL: env.VENICE_BASE_URL,
      fetch: veniceFetch,
    },
  });
};

/** Shared params: E2EE on, no Venice system prompt */
const baseVeniceParams = {
  enable_e2ee: true,
  include_venice_system_prompt: false,
};

const fastVeniceParams = {
  venice_parameters: {
    ...baseVeniceParams,
    disable_thinking: true,
    enable_web_search: "off" as const,
    enable_web_scraping: false,
    enable_web_citations: false,
    include_search_results_in_stream: false,
    return_search_results_as_documents: false,
  },
};

const researchVeniceParams = {
  venice_parameters: {
    ...baseVeniceParams,
    disable_thinking: false,
    enable_web_search: "on" as const,
    enable_web_scraping: true,
    enable_web_citations: true,
    include_search_results_in_stream: true,
    return_search_results_as_documents: false,
    prompt_cache_key: "maw-research",
  },
};

// VENICE_MODEL_OVERRIDE forces all tiers to use the same model (for fast testing)
const override = env.VENICE_MODEL_OVERRIDE;

// Model IDs — exported so log entries can reference the actual model in use
export const FAST_MODEL = override ?? "qwen3-5-9b";
export const RESEARCH_MODEL = override ?? "qwen3-5-9b";
export const REASONING_MODEL = override ?? "gemini-3-flash-preview";

// Fast: quick lookups, balance checks, simple parsing
export const fastLlm = getVeniceLlm({
  model: FAST_MODEL,
  temperature: 0.3,
  maxRetries: 1,
  modelKwargs: fastVeniceParams,
  timeout: LLM_TIMEOUT_FAST_MS,
});

// Research: market analysis, price lookups with web search + citations
export const researchLlm = getVeniceLlm({
  model: RESEARCH_MODEL,
  temperature: 0.5,
  maxRetries: 2,
  modelKwargs: researchVeniceParams,
  timeout: LLM_TIMEOUT_RESEARCH_MS,
});

const reasoningVeniceParams = {
  venice_parameters: {
    ...baseVeniceParams,
    disable_thinking: false,
    enable_web_search: "off" as const,
    enable_web_scraping: false,
    enable_web_citations: false,
    include_search_results_in_stream: false,
    return_search_results_as_documents: false,
    prompt_cache_key: "maw-reasoning",
  },
};

// Reasoning: complex decisions, intent compilation, rebalance logic
export const reasoningLlm = getVeniceLlm({
  model: REASONING_MODEL,
  temperature: 0,
  maxRetries: 2,
  maxTokens: 3000,
  modelKwargs: reasoningVeniceParams,
  timeout: LLM_TIMEOUT_REASONING_MS,
});
