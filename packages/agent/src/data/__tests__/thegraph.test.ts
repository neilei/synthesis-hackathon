/**
 * Unit tests for The Graph Uniswap V3 pool data queries.
 *
 * @module @veil/agent/data/thegraph.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolData } from "../thegraph.js";

const { mockRequest } = vi.hoisted(() => {
  const mockRequest = vi.fn();
  return { mockRequest };
});

vi.mock("graphql-request", () => {
  return {
    GraphQLClient: class {
      request = mockRequest;
    },
  };
});

vi.mock("../../config.js", () => ({
  THEGRAPH_UNISWAP_V3_BASE: "https://mock-subgraph.example.com",
  env: {
    THEGRAPH_API_KEY: undefined,
  },
}));

vi.mock("../../logging/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getPoolData } from "../thegraph.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPoolData", () => {
  it("transforms API response into correct PoolData[] shape", async () => {
    mockRequest.mockResolvedValueOnce({
      pools: [
        {
          id: "0xpool1",
          token0: { symbol: "WETH" },
          token1: { symbol: "USDC" },
          feeTier: "3000",
          totalValueLockedUSD: "15000000.50",
          volumeUSD: "2500000.00",
          txCount: "12345",
        },
        {
          id: "0xpool2",
          token0: { symbol: "WETH" },
          token1: { symbol: "USDC" },
          feeTier: "500",
          totalValueLockedUSD: "8000000.00",
          volumeUSD: "1200000.00",
          txCount: "6789",
        },
      ],
    });

    const result = await getPoolData("WETH", "USDC");

    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      id: "0xpool1",
      token0Symbol: "WETH",
      token1Symbol: "USDC",
      feeTier: "3000",
      totalValueLockedUSD: "15000000.50",
      volumeUSD: "2500000.00",
      txCount: "12345",
    });

    expect(result[1]).toEqual({
      id: "0xpool2",
      token0Symbol: "WETH",
      token1Symbol: "USDC",
      feeTier: "500",
      totalValueLockedUSD: "8000000.00",
      volumeUSD: "1200000.00",
      txCount: "6789",
    });
  });

  it("handles empty pool results", async () => {
    mockRequest.mockResolvedValueOnce({ pools: [] });

    const result = await getPoolData("FOO", "BAR");

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it("passes correct variables to the GraphQL query", async () => {
    mockRequest.mockResolvedValueOnce({ pools: [] });

    await getPoolData("ETH", "DAI");

    expect(mockRequest).toHaveBeenCalledTimes(1);
    const callArg = mockRequest.mock.calls[0][0];
    // SDK passes an object with { document, variables }
    if (typeof callArg === "object" && "variables" in callArg) {
      expect(callArg.variables).toEqual({ token0: "ETH", token1: "DAI" });
    } else {
      // Fallback: positional args (legacy format)
      expect(mockRequest.mock.calls[0][1]).toEqual({
        token0: "ETH",
        token1: "DAI",
      });
    }
  });

  it("flattens nested token objects into symbol strings", async () => {
    mockRequest.mockResolvedValueOnce({
      pools: [
        {
          id: "0xpool_nested",
          token0: { symbol: "AAVE" },
          token1: { symbol: "LINK" },
          feeTier: "10000",
          totalValueLockedUSD: "500000",
          volumeUSD: "100000",
          txCount: "999",
        },
      ],
    });

    const result = await getPoolData("AAVE", "LINK");

    expect(result[0].token0Symbol).toBe("AAVE");
    expect(result[0].token1Symbol).toBe("LINK");
    // Verify the nested token objects are NOT present on the flattened result
    const keys = Object.keys(result[0]);
    expect(keys).not.toContain("token0");
    expect(keys).not.toContain("token1");
  });

  it("propagates GraphQL errors after retry exhaustion", async () => {
    // withRetry uses maxRetries: 2 for thegraph, so 3 total attempts
    mockRequest.mockRejectedValue(new Error("Subgraph unavailable"));

    await expect(getPoolData("WETH", "USDC")).rejects.toThrow(
      "Subgraph unavailable",
    );
  });
});
