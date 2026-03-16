/**
 * Queries Uniswap V3 subgraph (The Graph) for pool data: TVL, volume, fee tiers.
 * Uses generated SDK from codegen. Called each cycle for market context.
 *
 * @module @veil/agent/data/thegraph
 */
import { GraphQLClient } from "graphql-request";
import { THEGRAPH_UNISWAP_V3_BASE, env } from "../config.js";
import { getSdk } from "../../__generated__/graphql.js";
import { withRetry } from "../utils/retry.js";

const graphClient = new GraphQLClient(THEGRAPH_UNISWAP_V3_BASE, {
  ...(env.THEGRAPH_API_KEY
    ? { headers: { Authorization: `Bearer ${env.THEGRAPH_API_KEY}` } }
    : {}),
});

const sdk = getSdk(graphClient);

export interface PoolData {
  id: string;
  token0Symbol: string;
  token1Symbol: string;
  feeTier: string;
  totalValueLockedUSD: string;
  volumeUSD: string;
  txCount: string;
}

/**
 * Query Uniswap V3 subgraph for pool data between two tokens.
 * Returns pools sorted by TVL (descending), up to 5 results.
 */
export async function getPoolData(
  token0Symbol: string,
  token1Symbol: string,
): Promise<PoolData[]> {
  const data = await withRetry(
    () => sdk.GetPools({ token0: token0Symbol, token1: token1Symbol }),
    { label: "thegraph:GetPools", maxRetries: 2 },
  );

  return data.pools.map((pool) => ({
    id: pool.id,
    token0Symbol: pool.token0.symbol,
    token1Symbol: pool.token1.symbol,
    feeTier: pool.feeTier,
    totalValueLockedUSD: pool.totalValueLockedUSD,
    volumeUSD: pool.volumeUSD,
    txCount: pool.txCount,
  }));
}
