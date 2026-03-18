/**
 * Market data gathering for the agent loop: prices, portfolio balances,
 * pool liquidity from The Graph, and drift calculation.
 *
 * @module @veil/agent/agent-loop/market-data
 */
import type { Address } from "viem";

import type { ChainEnv } from "../config.js";
import { getPortfolioBalance } from "../data/portfolio.js";
import { getTokenPrice } from "../data/prices.js";
import { getPoolData } from "../data/thegraph.js";
import { logAction } from "../logging/agent-log.js";
import { getBudgetTier } from "../logging/budget.js";
import type { IntentLogger } from "../logging/intent-log.js";
import { logger } from "../logging/logger.js";

export interface MarketData {
  ethPrice: { price: number; citation: string | null };
  portfolio: Awaited<ReturnType<typeof getPortfolioBalance>>;
  poolContext: string;
  budgetTier: ReturnType<typeof getBudgetTier>;
}

export async function gatherMarketData(
  chainId: number,
  agentAddress: Address,
  cycle: number,
  intentLogger?: IntentLogger,
): Promise<MarketData> {
  const budgetTier = getBudgetTier();
  if (budgetTier !== "normal") {
    logger.info({ budgetTier }, "Budget tier is not normal");
    logAction("budget_check", {
      cycle,
      result: { tier: budgetTier },
    });
    intentLogger?.log("budget_check", { cycle, result: { tier: budgetTier } });
  }

  // 1. Get ETH price
  const startPrice = Date.now();
  const ethPrice = await getTokenPrice("ETH");
  logAction("price_fetch", {
    cycle,
    tool: "venice-web-search",
    duration_ms: Date.now() - startPrice,
    result: { price: ethPrice.price, citation: ethPrice.citation },
  });
  intentLogger?.log("price_fetch", { cycle, tool: "venice-web-search", duration_ms: Date.now() - startPrice, result: { price: ethPrice.price } });
  logger.info(`ETH price: $${ethPrice.price.toFixed(2)}`);

  // 2. Get portfolio balance
  const chainEnv: ChainEnv =
    chainId === 8453
      ? "base"
      : chainId === 84532
        ? "base-sepolia"
        : "sepolia";

  const startPortfolio = Date.now();
  const portfolio = await getPortfolioBalance(
    agentAddress,
    chainEnv,
    ethPrice.price,
  );
  logAction("portfolio_check", {
    cycle,
    tool: "viem",
    duration_ms: Date.now() - startPortfolio,
    result: {
      totalUsdValue: portfolio.totalUsdValue,
      allocation: portfolio.allocation,
    },
  });
  intentLogger?.log("portfolio_check", { cycle, tool: "viem", duration_ms: Date.now() - startPortfolio, result: { totalUsdValue: portfolio.totalUsdValue, allocation: portfolio.allocation } });

  logger.info(
    `Portfolio: $${portfolio.totalUsdValue.toFixed(2)} | ` +
      Object.entries(portfolio.allocation)
        .map(([t, v]) => `${t}: ${(v * 100).toFixed(1)}%`)
        .join(", "),
  );

  // 3. Fetch pool data from The Graph (top 3 pools for richer LLM context)
  let poolContext = "";
  const startPool = Date.now();
  try {
    const pools = await getPoolData("WETH", "USDC");
    if (pools.length > 0) {
      const poolSummaries = pools.slice(0, 3).map((p, i) => {
        const tvl = Number(p.totalValueLockedUSD) || 0;
        const volume = Number(p.volumeUSD) || 0;
        const feeBps = Number(p.feeTier) / 100;
        return `Pool ${i + 1}: fee=${feeBps}bps, TVL=$${tvl.toLocaleString()}, 24h volume=$${volume.toLocaleString()}, txCount=${p.txCount}`;
      });
      poolContext = `WETH/USDC Uniswap V3 pools (by TVL):\n${poolSummaries.join("\n")}\n\nPool selection guidance: Higher TVL = deeper liquidity = less slippage. Higher volume = more active trading. Fee tier matters: 5bps (0.05%) is cheapest but may have less liquidity; 30bps (0.3%) is standard; 100bps (1%) is for volatile pairs.`;
      logger.info({ poolCount: pools.length }, "Pool data fetched for LLM context");
    }
    logAction("pool_data_fetch", {
      cycle,
      tool: "thegraph",
      duration_ms: Date.now() - startPool,
      result: { poolCount: pools.length, topPool: pools[0] ?? null },
    });
    intentLogger?.log("pool_data_fetch", { cycle, tool: "thegraph", duration_ms: Date.now() - startPool, result: { poolCount: pools.length } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Pool data unavailable");
    logAction("pool_data_fetch", {
      cycle,
      tool: "thegraph",
      duration_ms: Date.now() - startPool,
      error: msg,
    });
    intentLogger?.log("pool_data_fetch", { cycle, tool: "thegraph", duration_ms: Date.now() - startPool, error: msg });
  }

  return { ethPrice, portfolio, poolContext, budgetTier };
}
