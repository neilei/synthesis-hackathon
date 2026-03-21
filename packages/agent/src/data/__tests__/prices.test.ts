/**
 * Unit tests for token price lookup via CoinMarketCap and caching behavior.
 *
 * @module @maw/agent/data/prices.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock logger
vi.mock("../../logging/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock config — env.CMC_PRO_API_KEY is read at call time (not import time)
const mockEnv = vi.hoisted(() => ({ CMC_PRO_API_KEY: "test-key" as string | undefined }));
vi.mock("../../config.js", () => ({ env: mockEnv }));

import { getTokenPrice, clearPriceCache, _getPriceCache } from "../prices.js";

function cmcResponse(symbol: string, price: number, slug: string) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        status: { timestamp: new Date().toISOString(), error_code: 0, error_message: null },
        data: {
          [symbol]: [
            {
              id: 1027,
              name: symbol === "ETH" ? "Ethereum" : symbol,
              symbol,
              slug,
              cmc_rank: 2,
              quote: { USD: { price, volume_24h: 1e9, percent_change_24h: 1.5, market_cap: 2e11, last_updated: new Date().toISOString() } },
            },
          ],
        },
      }),
  };
}

describe("getTokenPrice", () => {
  beforeEach(() => {
    clearPriceCache();
    vi.clearAllMocks();
    mockEnv.CMC_PRO_API_KEY = "test-key";
    mockFetch.mockResolvedValue(cmcResponse("ETH", 2000, "ethereum"));
  });

  afterEach(() => {
    clearPriceCache();
  });

  it("should return price and citation from CMC", async () => {
    const result = await getTokenPrice("ETH");

    expect(result.price).toBe(2000);
    expect(result.citation).toBe("https://coinmarketcap.com/currencies/ethereum/");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("symbol=ETH"),
      expect.objectContaining({
        headers: { "X-CMC_PRO_API_KEY": "test-key" },
      }),
    );
  });

  it("should cache results and not call API twice within TTL", async () => {
    const result1 = await getTokenPrice("ETH");
    const result2 = await getTokenPrice("ETH");

    expect(result1.price).toBe(result2.price);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should normalize symbol to uppercase for cache key", async () => {
    await getTokenPrice("eth");
    await getTokenPrice("ETH");
    await getTokenPrice("Eth");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should call API again after cache expires", async () => {
    await getTokenPrice("ETH");

    // Manually expire the cache entry
    const cache = _getPriceCache();
    const entry = cache.get("ETH")!;
    entry.timestamp = Date.now() - 61_000;

    mockFetch.mockResolvedValue(cmcResponse("ETH", 2100, "ethereum"));

    const result = await getTokenPrice("ETH");

    expect(result.price).toBe(2100);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should cache different tokens separately", async () => {
    mockFetch
      .mockResolvedValueOnce(cmcResponse("ETH", 2000, "ethereum"))
      .mockResolvedValueOnce(cmcResponse("USDC", 1, "usd-coin"));

    const ethResult = await getTokenPrice("ETH");
    const usdcResult = await getTokenPrice("USDC");

    expect(ethResult.price).toBe(2000);
    expect(usdcResult.price).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should throw on API error response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(getTokenPrice("ETH")).rejects.toThrow("CoinMarketCap API error 401");
  });

  it("should throw when CMC_PRO_API_KEY is missing", async () => {
    mockEnv.CMC_PRO_API_KEY = "";
    clearPriceCache();

    await expect(getTokenPrice("ETH")).rejects.toThrow("CMC_PRO_API_KEY is required");
  });

  it("should pick highest-ranked token when multiple share a symbol", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: { timestamp: new Date().toISOString(), error_code: 0, error_message: null },
          data: {
            ETH: [
              { id: 9999, name: "Fake ETH", symbol: "ETH", slug: "fake-eth", cmc_rank: 500, quote: { USD: { price: 0.01, volume_24h: 100, percent_change_24h: 0, market_cap: 100, last_updated: new Date().toISOString() } } },
              { id: 1027, name: "Ethereum", symbol: "ETH", slug: "ethereum", cmc_rank: 2, quote: { USD: { price: 2000, volume_24h: 1e9, percent_change_24h: 1.5, market_cap: 2e11, last_updated: new Date().toISOString() } } },
            ],
          },
        }),
    });

    const result = await getTokenPrice("ETH");
    expect(result.price).toBe(2000);
    expect(result.citation).toContain("ethereum");
  });

  it("should ignore tokens with null cmc_rank", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: { timestamp: new Date().toISOString(), error_code: 0, error_message: null },
          data: {
            ETH: [
              { id: 29991, name: "The Infinite Garden", symbol: "ETH", slug: "the-infinite-garden", cmc_rank: null, quote: { USD: { price: null, volume_24h: 0, percent_change_24h: 0, market_cap: 0, last_updated: new Date().toISOString() } } },
              { id: 1027, name: "Ethereum", symbol: "ETH", slug: "ethereum", cmc_rank: 2, quote: { USD: { price: 2000, volume_24h: 1e9, percent_change_24h: 1.5, market_cap: 2e11, last_updated: new Date().toISOString() } } },
            ],
          },
        }),
    });

    const result = await getTokenPrice("ETH");
    expect(result.price).toBe(2000);
    expect(result.citation).toContain("ethereum");
  });
});
