/**
 * Fetches ETH and USDC on-chain balances via viem, computes USD values and
 * allocation percentages. Called each cycle by the agent loop.
 *
 * @module @veil/agent/data/portfolio
 */
import {
  createPublicClient,
  http,
  formatEther,
  formatUnits,
  type Address,
} from "viem";
import { sepolia, base } from "viem/chains";
import { CONTRACTS, type ChainEnv } from "../config.js";
import type { PortfolioState } from "../types.js";

const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const chainConfigs: Record<
  ChainEnv,
  { chain: typeof sepolia | typeof base; usdc: Address }
> = {
  sepolia: { chain: sepolia, usdc: CONTRACTS.USDC_SEPOLIA },
  "base-sepolia": { chain: sepolia, usdc: CONTRACTS.USDC_SEPOLIA }, // fallback
  base: { chain: base, usdc: CONTRACTS.USDC_BASE },
};

function getClient(chainEnv: ChainEnv) {
  const config = chainConfigs[chainEnv];
  return createPublicClient({
    chain: config.chain,
    transport: http(),
  });
}

/** Default public client for Sepolia */
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

/**
 * Fetch ETH and USDC balances for a given address, returning
 * a full PortfolioState with raw balances, formatted values,
 * USD values, and allocation percentages.
 *
 * @param address   - Wallet address to query
 * @param chain     - Which chain environment to use
 * @param ethPriceUsd - Current ETH price in USD (pass from prices.ts)
 */
export async function getPortfolioBalance(
  address: Address,
  chain: ChainEnv,
  ethPriceUsd: number,
): Promise<PortfolioState> {
  const client = getClient(chain);
  const config = chainConfigs[chain];

  const [ethBalanceRaw, usdcBalanceRaw] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({
      address: config.usdc,
      abi: erc20BalanceOfAbi,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);

  const ethFormatted = formatEther(ethBalanceRaw);
  const usdcFormatted = formatUnits(usdcBalanceRaw, 6); // USDC has 6 decimals

  const ethUsdValue = parseFloat(ethFormatted) * ethPriceUsd;
  const usdcUsdValue = parseFloat(usdcFormatted); // USDC ~= $1

  const totalUsdValue = ethUsdValue + usdcUsdValue;

  const ethAllocation = totalUsdValue > 0 ? ethUsdValue / totalUsdValue : 0;
  const usdcAllocation = totalUsdValue > 0 ? usdcUsdValue / totalUsdValue : 0;

  return {
    address,
    balances: {
      ETH: {
        raw: ethBalanceRaw,
        formatted: ethFormatted,
        usdValue: ethUsdValue,
      },
      USDC: {
        raw: usdcBalanceRaw,
        formatted: usdcFormatted,
        usdValue: usdcUsdValue,
      },
    },
    totalUsdValue,
    allocation: {
      ETH: ethAllocation,
      USDC: usdcAllocation,
    },
    drift: {}, // Drift is computed against a target intent; empty here
    maxDrift: 0,
    timestamp: Date.now(),
  };
}
