/**
 * Venice AI LLM instances via LangChain. Three tiers: fast (qwen3-4b),
 * research (gemini-3-flash-preview with web search), reasoning (gemini-3-1-pro-preview).
 * Custom fetch wrapper captures billing headers for budget tracking.
 *
 * Venice-specific features:
 * - enable_e2ee: true — end-to-end encryption for E2EE-capable models (default true, set explicitly for visibility)
 * - prompt_cache_key — routing hint to improve cache hit rates on repeated system prompts
 * - reasoning_effort — set per-call in agent-loop.ts, not here (tier-level setting would override per-call)
 *
 * @see https://docs.venice.ai/api-reference/endpoint/chat/completions
 * @module @veil/agent/venice/llm
 */
import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import { env } from "../config.js";
import { updateBudget } from "../logging/budget.js";

// LLM timeout constants (milliseconds)
const LLM_TIMEOUT_FAST_MS = 60_000;
const LLM_TIMEOUT_RESEARCH_MS = 120_000;
const LLM_TIMEOUT_REASONING_MS = 300_000;

// Custom fetch that captures Venice billing headers
const veniceFetch: typeof globalThis.fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  const balanceHeader = response.headers.get("x-venice-balance-usd");
  if (balanceHeader) {
    updateBudget({ "x-venice-balance-usd": balanceHeader });
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
    prompt_cache_key: "veil-research",
  },
};

const reasoningVeniceParams = {
  venice_parameters: {
    ...baseVeniceParams,
    disable_thinking: false,
    enable_web_search: "off" as const,
    enable_web_scraping: false,
    enable_web_citations: false,
    include_search_results_in_stream: false,
    return_search_results_as_documents: false,
    prompt_cache_key: "veil-reasoning",
  },
};

// VENICE_MODEL_OVERRIDE forces all tiers to use the same model (for fast testing)
const override = env.VENICE_MODEL_OVERRIDE;

// Fast: quick lookups, balance checks, simple parsing
export const fastLlm = getVeniceLlm({
  model: override ?? "qwen3-4b",
  temperature: 0.3,
  maxRetries: 1,
  modelKwargs: fastVeniceParams,
  timeout: LLM_TIMEOUT_FAST_MS,
});

// Research: market analysis, price lookups with web search + citations
export const researchLlm = getVeniceLlm({
  model: override ?? "gemini-3-flash-preview",
  temperature: 0.5,
  maxRetries: 2,
  modelKwargs: researchVeniceParams,
  timeout: LLM_TIMEOUT_RESEARCH_MS,
});

// Reasoning: complex decisions, intent compilation, rebalance logic
export const reasoningLlm = getVeniceLlm({
  model: override ?? "gemini-3-1-pro-preview",
  temperature: 0,
  maxRetries: 2,
  modelKwargs: reasoningVeniceParams,
  timeout: LLM_TIMEOUT_REASONING_MS,
});
