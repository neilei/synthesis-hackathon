/**
 * Core domain types for intent, portfolio state, rebalance decisions, and log entries.
 * Consumed by agent-loop, delegation, and logging modules.
 *
 * @module @veil/agent/types
 */
import type { Address } from "viem";

export interface Intent {
  targetAllocation: Record<string, number>; // e.g. { ETH: 0.6, USDC: 0.4 }
  dailyBudgetUsd: number;
  timeWindowDays: number;
  maxTradesPerDay: number;
  maxSlippage: number; // e.g. 0.005 for 0.5%
  driftThreshold: number; // e.g. 0.05 for 5%
}

export interface RebalanceDecision {
  shouldRebalance: boolean;
  reasoning: string;
  marketContext?: string;
  targetSwap?: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    maxSlippage: string;
  };
}

export interface PortfolioState {
  address: Address;
  balances: Record<string, { raw: bigint; formatted: string; usdValue: number }>;
  totalUsdValue: number;
  allocation: Record<string, number>; // percentage 0-1
  drift: Record<string, number>; // difference from target
  maxDrift: number;
  timestamp: number;
}

export interface AgentLogEntry {
  timestamp: string;
  sequence: number;
  action: string;
  tool: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  duration_ms: number;
  success: boolean;
  error?: string;
}

export interface DelegationConfig {
  delegatorAddress: Address;
  agentAddress: Address;
  scope: {
    type: string;
    tokenAddress?: Address;
    maxAmount?: bigint;
  };
  caveats: Array<{
    type: string;
    [key: string]: unknown;
  }>;
  expiryTimestamp: number;
}
