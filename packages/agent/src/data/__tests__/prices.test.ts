/**
 * Unit tests for token price lookup and caching behavior.
 *
 * @module @veil/agent/data/prices.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Venice LLM module
vi.mock("../../venice/llm.js", () => {
  const mockInvoke = vi.fn();
  return {
    researchLlm: {
      withStructuredOutput: vi.fn(() => ({
        invoke: mockInvoke,
      })),
    },
    __mockInvoke: mockInvoke,
  };
});

import { getTokenPrice, clearPriceCache, _getPriceCache } from "../prices.js";
import { researchLlm } from "../../venice/llm.js";

// Get the mock invoke function
const mockInvoke = (
  await import("../../venice/llm.js") as any
).__mockInvoke as ReturnType<typeof vi.fn>;

describe("getTokenPrice", () => {
  beforeEach(() => {
    clearPriceCache();
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({
      price: 2000,
      citation: "https://example.com/eth-price",
    });
  });

  afterEach(() => {
    clearPriceCache();
  });

  it("should return price and citation from LLM", async () => {
    const result = await getTokenPrice("ETH");

    expect(result.price).toBe(2000);
    expect(result.citation).toBe("https://example.com/eth-price");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("should cache results and not call LLM twice within TTL", async () => {
    const result1 = await getTokenPrice("ETH");
    const result2 = await getTokenPrice("ETH");

    expect(result1.price).toBe(result2.price);
    expect(mockInvoke).toHaveBeenCalledTimes(1); // Only called once due to cache
  });

  it("should normalize symbol to uppercase for cache key", async () => {
    await getTokenPrice("eth");
    await getTokenPrice("ETH");
    await getTokenPrice("Eth");

    // All should hit the same cache entry, so only 1 LLM call
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("should call LLM again after cache expires", async () => {
    await getTokenPrice("ETH");

    // Manually expire the cache entry
    const cache = _getPriceCache();
    const entry = cache.get("ETH")!;
    entry.timestamp = Date.now() - 61_000; // 61 seconds ago

    mockInvoke.mockResolvedValue({
      price: 2100,
      citation: "https://example.com/eth-price-2",
    });

    const result = await getTokenPrice("ETH");

    expect(result.price).toBe(2100);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("should cache different tokens separately", async () => {
    mockInvoke
      .mockResolvedValueOnce({ price: 2000, citation: null })
      .mockResolvedValueOnce({ price: 1, citation: null });

    const ethResult = await getTokenPrice("ETH");
    const usdcResult = await getTokenPrice("USDC");

    expect(ethResult.price).toBe(2000);
    expect(usdcResult.price).toBe(1);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("should handle null citation", async () => {
    mockInvoke.mockResolvedValue({ price: 1, citation: null });

    const result = await getTokenPrice("USDC");

    expect(result.citation).toBeNull();
  });
});
