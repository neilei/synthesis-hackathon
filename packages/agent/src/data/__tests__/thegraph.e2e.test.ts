/**
 * E2E tests for The Graph Uniswap V3 pool data against live subgraph.
 *
 * @module @maw/agent/data/thegraph.e2e.test
 */
import { describe, it, expect } from "vitest";
import { getPoolData } from "../thegraph.js";
import { env } from "../../config.js";
import type { PoolData } from "../thegraph.js";

describe("getPoolData (e2e)", () => {
  it.skipIf(!env.THEGRAPH_API_KEY)(
    "fetches real WETH/USDC pool data from Uniswap V3 subgraph",
    { timeout: 30000 },
    async () => {
      const pools = await getPoolData("WETH", "USDC");

      expect(Array.isArray(pools)).toBe(true);
      // WETH/USDC is the most popular pair — there must be at least one pool
      expect(pools.length).toBeGreaterThan(0);

      const pool: PoolData = pools[0];

      // Validate all fields exist and are strings
      expect(typeof pool.id).toBe("string");
      expect(pool.id).toMatch(/^0x/);
      expect(typeof pool.token0Symbol).toBe("string");
      expect(typeof pool.token1Symbol).toBe("string");
      expect(typeof pool.feeTier).toBe("string");
      expect(typeof pool.totalValueLockedUSD).toBe("string");
      expect(typeof pool.volumeUSD).toBe("string");
      expect(typeof pool.txCount).toBe("string");

      // Token symbols should be WETH or USDC (in either order)
      const symbols = [pool.token0Symbol, pool.token1Symbol].sort();
      expect(symbols).toEqual(["USDC", "WETH"]);

      // TVL and volume should be parseable numbers
      expect(Number(pool.totalValueLockedUSD)).toBeGreaterThan(0);
      expect(Number(pool.volumeUSD)).toBeGreaterThan(0);

      // Verify no nested objects leaked through (flattening works)
      const keys = Object.keys(pool);
      expect(keys).not.toContain("token0");
      expect(keys).not.toContain("token1");
    },
  );

  it.skipIf(!env.THEGRAPH_API_KEY)(
    "returns empty array for nonexistent token pair",
    { timeout: 30000 },
    async () => {
      const pools = await getPoolData("FAKECOIN123", "NOTREAL456");
      expect(pools).toEqual([]);
    },
  );
});
