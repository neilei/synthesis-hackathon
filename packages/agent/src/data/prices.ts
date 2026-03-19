/**
 * Token price lookup via Venice web search LLM with 60-second caching.
 * Returns price, citation URL, and LLM token usage. Called each cycle by the agent loop.
 *
 * @module @veil/agent/data/prices
 */
import { AIMessage } from "@langchain/core/messages";
import { researchLlm, type LlmUsage } from "../venice/llm.js";
import { PriceResponseSchema } from "../venice/schemas.js";

interface CacheEntry {
  price: number;
  citation: string | null;
  timestamp: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const priceCache = new Map<string, CacheEntry>();

export interface PriceResult {
  price: number;
  citation: string | null;
  usage?: LlmUsage;
}

/**
 * Get the current price of a token in USD via Venice web search.
 * Results are cached for 60 seconds to avoid excessive API calls.
 */
export async function getTokenPrice(symbol: string): Promise<PriceResult> {
  const key = symbol.toUpperCase();
  const cached = priceCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { price: cached.price, citation: cached.citation };
  }

  const structuredLlm = researchLlm.withStructuredOutput(PriceResponseSchema, {
    method: "functionCalling",
    includeRaw: true,
  });

  const result = await structuredLlm.invoke(
    `What is the current price of ${key} in USD? Return only the price as a number and a citation URL if available.`,
  );

  const entry: CacheEntry = {
    price: result.parsed.price,
    citation: result.parsed.citation,
    timestamp: Date.now(),
  };
  priceCache.set(key, entry);

  const meta = result.raw instanceof AIMessage ? result.raw.usage_metadata : undefined;
  const usage: LlmUsage | undefined = meta
    ? {
        inputTokens: meta.input_tokens,
        outputTokens: meta.output_tokens,
        totalTokens: meta.total_tokens,
      }
    : undefined;

  return { price: result.parsed.price, citation: result.parsed.citation, usage };
}

/** Exposed for testing: clear the price cache */
export function clearPriceCache(): void {
  priceCache.clear();
}

/** Exposed for testing: get the raw cache map */
export function _getPriceCache(): Map<string, CacheEntry> {
  return priceCache;
}
