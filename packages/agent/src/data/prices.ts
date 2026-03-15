/**
 * Token price lookup via Venice web search LLM with 60-second caching.
 * Returns price and citation URL. Called each cycle by the agent loop.
 *
 * @module @veil/agent/data/prices
 */
import { researchLlm } from "../venice/llm.js";
import { PriceResponseSchema } from "../venice/schemas.js";

interface CacheEntry {
  price: number;
  citation: string | null;
  timestamp: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const priceCache = new Map<string, CacheEntry>();

/**
 * Get the current price of a token in USD via Venice web search.
 * Results are cached for 60 seconds to avoid excessive API calls.
 */
export async function getTokenPrice(
  symbol: string,
): Promise<{ price: number; citation: string | null }> {
  const key = symbol.toUpperCase();
  const cached = priceCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { price: cached.price, citation: cached.citation };
  }

  const structuredLlm = researchLlm.withStructuredOutput(PriceResponseSchema, {
    method: "functionCalling",
  });

  const result = await structuredLlm.invoke(
    `What is the current price of ${key} in USD? Return only the price as a number and a citation URL if available.`,
  );

  const entry: CacheEntry = {
    price: result.price,
    citation: result.citation,
    timestamp: Date.now(),
  };
  priceCache.set(key, entry);

  return { price: result.price, citation: result.citation };
}

/** Exposed for testing: clear the price cache */
export function clearPriceCache(): void {
  priceCache.clear();
}

/** Exposed for testing: get the raw cache map */
export function _getPriceCache(): Map<string, CacheEntry> {
  return priceCache;
}
