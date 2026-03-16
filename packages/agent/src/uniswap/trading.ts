/**
 * Uniswap Trading API client. Provides quote, approval check, swap creation,
 * and a full swap flow helper. Used by the agent loop for all DEX interactions.
 *
 * @module @veil/agent/uniswap/trading
 */
import type { Address, Hex } from "viem";
import { z } from "zod";
import { env, UNISWAP_API_BASE, CONTRACTS } from "../config.js";
import {
  ApprovalResponseSchema,
  QuoteResponseSchema,
  SwapResponseSchema,
} from "./schemas.js";
import type { ApprovalResponse, QuoteResponse, SwapResponse } from "./schemas.js";

export type { ApprovalResponse, QuoteResponse, SwapResponse };

/** Default slippage tolerance in percent (0.5 = 0.5%). */
const DEFAULT_SLIPPAGE_TOLERANCE = 0.5;

// ---------------------------------------------------------------------------
// Types (request shapes — constructed by the agent, not validated from API)
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  token: Address;
  amount: string;
  chainId: number;
  walletAddress: Address;
}

export interface QuoteRequest {
  tokenIn: Address;
  tokenOut: Address;
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  chainId: number;
  swapper: Address;
  slippageTolerance?: number;
}

export interface SwapRequest {
  quote: QuoteResponse["quote"];
  signature?: Hex;
  permitData?: QuoteResponse["permitData"];
  simulateTransaction?: boolean;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

async function uniswapFetch<T>(
  endpoint: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const res = await fetch(`${UNISWAP_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.UNISWAP_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Uniswap API ${endpoint} failed (${res.status}): ${text}`,
    );
  }

  const json: unknown = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Uniswap API ${endpoint} response validation failed: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// checkApproval — check if token is approved for Permit2
// ---------------------------------------------------------------------------

export async function checkApproval(
  params: ApprovalRequest,
): Promise<ApprovalResponse> {
  return uniswapFetch<ApprovalResponse>(
    "/check_approval",
    {
      token: params.token,
      amount: params.amount,
      chainId: params.chainId,
      walletAddress: params.walletAddress,
    },
    ApprovalResponseSchema,
  );
}

// ---------------------------------------------------------------------------
// getQuote — get a swap quote
// ---------------------------------------------------------------------------

export async function getQuote(params: QuoteRequest): Promise<QuoteResponse> {
  return uniswapFetch<QuoteResponse>(
    "/quote",
    {
      tokenInChainId: params.chainId,
      tokenOutChainId: params.chainId,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amount: params.amount,
      type: params.type,
      swapper: params.swapper,
      slippageTolerance: params.slippageTolerance ?? DEFAULT_SLIPPAGE_TOLERANCE,
    },
    QuoteResponseSchema,
  );
}

// ---------------------------------------------------------------------------
// createSwap — create a swap transaction from a quote
// ---------------------------------------------------------------------------

export async function createSwap(
  quote: QuoteResponse,
  signature?: Hex,
  options?: { disableSimulation?: boolean },
): Promise<SwapResponse> {
  const body: Record<string, unknown> = {
    quote: quote.quote,
    // Disable simulation when:
    // 1. Permit data is present — nonces haven't been consumed yet
    // 2. Delegation path — swap executes from smart account, not the swapper directly
    simulateTransaction:
      options?.disableSimulation ? false : !quote.permitData,
  };

  if (quote.permitData && signature) {
    body.permitData = quote.permitData;
    body.signature = signature;
  }

  return uniswapFetch<SwapResponse>("/swap", body, SwapResponseSchema);
}

