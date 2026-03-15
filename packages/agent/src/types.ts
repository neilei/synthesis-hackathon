/**
 * Core domain types consumed only within the agent package.
 *
 * @module @veil/agent/types
 */
import type { Address } from "viem";

export interface PortfolioState {
  address: Address;
  balances: Record<string, { raw: bigint; formatted: string; usdValue: number }>;
  totalUsdValue: number;
  allocation: Record<string, number>;
  drift: Record<string, number>;
  maxDrift: number;
  timestamp: number;
}
