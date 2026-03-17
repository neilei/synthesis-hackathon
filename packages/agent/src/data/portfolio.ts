/**
 * Fetches ETH and USDC on-chain balances via viem, computes USD values and
 * allocation percentages. Called each cycle by the agent loop.
 *
 * @module @veil/agent/data/portfolio
 */
import {
  createPublicClient,
  formatEther,
  formatUnits,
  type Address,
} from "viem";
import { sepolia, baseSepolia, base } from "viem/chains";
import { CONTRACTS, rpcTransport, type ChainEnv } from "../config.js";

export interface PortfolioState {
  address: Address;
  balances: Record<string, { raw: bigint; formatted: string; usdValue: number }>;
  totalUsdValue: number;
  allocation: Record<string, number>; // percentage 0-1
  drift: Record<string, number>; // difference from target
  maxDrift: number;
  timestamp: number;
}

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
  { chain: typeof sepolia | typeof baseSepolia | typeof base; usdc: Address }
> = {
  sepolia: { chain: sepolia, usdc: CONTRACTS.USDC_SEPOLIA },
  // No USDC contract on Base Sepolia — use Sepolia USDC address as fallback token,
  // but query the correct Base Sepolia chain for ETH balance
  "base-sepolia": { chain: baseSepolia, usdc: CONTRACTS.USDC_SEPOLIA },
  base: { chain: base, usdc: CONTRACTS.USDC_BASE },
};

function getClient(chainEnv: ChainEnv) {
  const config = chainConfigs[chainEnv];
  return createPublicClient({
    chain: config.chain,
    transport: rpcTransport(chainEnv),
  });
}

/** Default public client for Sepolia */
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: rpcTransport("sepolia"),
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
