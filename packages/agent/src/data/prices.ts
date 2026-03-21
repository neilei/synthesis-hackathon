/**
 * Token price lookup via CoinMarketCap API with 60-second caching.
 * Returns price and source. Called each cycle by the agent loop.
 *
 * Requires CMC_PRO_API_KEY in environment.
 *
 * @module @maw/agent/data/prices
 */
import { env } from "../config.js";
import { logger } from "../logging/logger.js";

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
}

const CMC_BASE_URL = "https://pro-api.coinmarketcap.com";

/**
 * Get the current price of a token in USD via CoinMarketCap.
 * Results are cached for 60 seconds to avoid excessive API calls.
 */
export async function getTokenPrice(symbol: string): Promise<PriceResult> {
  const key = symbol.toUpperCase();
  const cached = priceCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { price: cached.price, citation: cached.citation };
  }

  const cmcApiKey = env.CMC_PRO_API_KEY;
  if (!cmcApiKey) {
    throw new Error("CMC_PRO_API_KEY is required for price lookups");
  }

  const url = `${CMC_BASE_URL}/v2/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(key)}&convert=USD`;
  const response = await fetch(url, {
    headers: { "X-CMC_PRO_API_KEY": cmcApiKey },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CoinMarketCap API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as CMCResponse;

  if (data.status.error_code !== 0) {
    throw new Error(`CoinMarketCap API error: ${data.status.error_message}`);
  }

  // CMC returns data keyed by symbol — the value is an array (multiple tokens can share a symbol)
  const tokenEntries = data.data[key];
  if (!tokenEntries || tokenEntries.length === 0) {
    throw new Error(`No CoinMarketCap data for symbol: ${key}`);
  }

  // Pick the highest-ranked (lowest cmc_rank) entry; null ranks treated as unranked
  const rank = (t: CMCToken) => t.cmc_rank ?? Infinity;
  const token = tokenEntries.reduce((best, current) =>
    rank(current) < rank(best) ? current : best,
  );

  const usdQuote = token.quote.USD;
  if (!usdQuote) {
    throw new Error(`No USD quote for ${key} from CoinMarketCap`);
  }

  const price = usdQuote.price;
  const citation = `https://coinmarketcap.com/currencies/${token.slug}/`;

  logger.debug({ symbol: key, price, slug: token.slug }, "CMC price fetched");

  const entry: CacheEntry = { price, citation, timestamp: Date.now() };
  priceCache.set(key, entry);

  return { price, citation };
}

/** Exposed for testing: clear the price cache */
export function clearPriceCache(): void {
  priceCache.clear();
}

/** Exposed for testing: get the raw cache map */
export function _getPriceCache(): Map<string, CacheEntry> {
  return priceCache;
}

// ── CMC response types ────────────────────────────────────────────────

interface CMCQuote {
  price: number;
  volume_24h: number;
  percent_change_24h: number;
  market_cap: number;
  last_updated: string;
}

interface CMCToken {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  cmc_rank: number | null;
  quote: Record<string, CMCQuote>;
}

interface CMCResponse {
  status: {
    timestamp: string;
    error_code: number;
    error_message: string | null;
  };
  data: Record<string, CMCToken[]>;
}
