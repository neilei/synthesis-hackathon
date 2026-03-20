/**
 * E2E tests for token price lookup against live CoinMarketCap API.
 *
 * @module @veil/agent/data/prices.e2e.test
 */
import { describe, it, expect } from "vitest";
import {
  getTokenPrice,
  clearPriceCache,
  _getPriceCache,
} from "../prices.js";

describe("getTokenPrice (e2e)", () => {
  it(
    "fetches real ETH price via CoinMarketCap",
    { timeout: 30000 },
    async () => {
      clearPriceCache();
      const result = await getTokenPrice("ETH");

      expect(typeof result.price).toBe("number");
      // ETH should be in a reasonable range
      expect(result.price).toBeGreaterThan(100);
      expect(result.price).toBeLessThan(100000);

      // Citation should be a CMC URL
      expect(result.citation).toContain("coinmarketcap.com");
    },
  );

  it(
    "cached result returns instantly on second call",
    { timeout: 10000 },
    async () => {
      // Ensure cache is populated from the previous test
      if (_getPriceCache().size === 0) {
        await getTokenPrice("ETH");
      }

      const start = Date.now();
      const result = await getTokenPrice("ETH");
      const elapsed = Date.now() - start;

      expect(typeof result.price).toBe("number");
      expect(result.price).toBeGreaterThan(100);
      // Cached call should be near-instant
      expect(elapsed).toBeLessThan(100);
    },
  );

  it(
    "cache is correctly populated after fetch",
    { timeout: 30000 },
    async () => {
      clearPriceCache();
      expect(_getPriceCache().size).toBe(0);

      await getTokenPrice("ETH");

      const cache = _getPriceCache();
      expect(cache.size).toBe(1);
      expect(cache.has("ETH")).toBe(true);

      const entry = cache.get("ETH")!;
      expect(typeof entry.price).toBe("number");
      expect(entry.price).toBeGreaterThan(0);
      expect(typeof entry.timestamp).toBe("number");
      expect(entry.timestamp).toBeLessThanOrEqual(Date.now());
    },
  );

  it(
    "clearPriceCache removes all entries",
    async () => {
      if (_getPriceCache().size === 0) {
        _getPriceCache().set("TEST", {
          price: 1,
          citation: null,
          timestamp: Date.now(),
        });
      }

      expect(_getPriceCache().size).toBeGreaterThan(0);
      clearPriceCache();
      expect(_getPriceCache().size).toBe(0);
    },
  );

  it(
    "different token symbols get separate cache entries",
    { timeout: 30000 },
    async () => {
      clearPriceCache();

      const [ethResult, btcResult] = await Promise.all([
        getTokenPrice("ETH"),
        getTokenPrice("BTC"),
      ]);

      const cache = _getPriceCache();
      expect(cache.size).toBe(2);
      expect(cache.has("ETH")).toBe(true);
      expect(cache.has("BTC")).toBe(true);

      // Prices should differ
      expect(ethResult.price).not.toBe(btcResult.price);
      // BTC should be significantly more expensive than ETH
      expect(btcResult.price).toBeGreaterThan(ethResult.price);
    },
  );
});
