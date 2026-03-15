/**
 * Uniswap Trading API client. Provides quote, approval check, swap creation,
 * and a full swap flow helper. Used by the agent loop for all DEX interactions.
 *
 * @module @veil/agent/uniswap/trading
 */
import type { Address, Hex } from "viem";
import { env, UNISWAP_API_BASE, CONTRACTS } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  token: Address;
  amount: string;
  chainId: number;
  walletAddress: Address;
}

export interface ApprovalResponse {
  approval: {
    tokenAddress: Address;
    spender: Address;
    amount: string;
    transactionRequest?: {
      to: Address;
      data: Hex;
      value: string;
    };
  };
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

export interface QuoteResponse {
  requestId: string;
  quote: {
    chainId: number;
    input: { token: Address; amount: string };
    output: { token: Address; amount: string };
    swapper: Address;
    slippage: { tolerance: number };
  };
  routing: string;
  permitData?: {
    domain: Record<string, unknown>;
    types: Record<string, unknown[]>;
    values: Record<string, unknown>;
  };
}

export interface SwapRequest {
  quote: QuoteResponse["quote"];
  signature?: Hex;
  permitData?: QuoteResponse["permitData"];
  simulateTransaction?: boolean;
}

export interface SwapResponse {
  swap: {
    chainId: number;
    to: Address;
    data: Hex;
    value: string;
    gasLimit?: string;
  };
  requestId: string;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

async function uniswapFetch<T>(
  endpoint: string,
  body: Record<string, unknown>,
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

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// checkApproval — check if token is approved for Permit2
// ---------------------------------------------------------------------------

export async function checkApproval(
  params: ApprovalRequest,
): Promise<ApprovalResponse> {
  return uniswapFetch<ApprovalResponse>("/check_approval", {
    token: params.token,
    amount: params.amount,
    chainId: params.chainId,
    walletAddress: params.walletAddress,
  });
}

// ---------------------------------------------------------------------------
// getQuote — get a swap quote
// ---------------------------------------------------------------------------

export async function getQuote(params: QuoteRequest): Promise<QuoteResponse> {
  return uniswapFetch<QuoteResponse>("/quote", {
    tokenInChainId: params.chainId,
    tokenOutChainId: params.chainId,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amount: params.amount,
    type: params.type,
    swapper: params.swapper,
    slippageTolerance: params.slippageTolerance ?? 0.5,
  });
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

  return uniswapFetch<SwapResponse>("/swap", body);
}

// ---------------------------------------------------------------------------
// Full swap flow helper
// ---------------------------------------------------------------------------

export interface ExecuteSwapParams {
  tokenIn: Address;
  tokenOut: Address;
  amount: string;
  chainId: number;
  walletAddress: Address;
  signTypedData: (params: {
    domain: Record<string, unknown>;
    types: Record<string, unknown[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<Hex>;
  sendTransaction: (params: {
    to: Address;
    data: Hex;
    value: bigint;
  }) => Promise<Hex>;
}

export async function executeFullSwap(
  params: ExecuteSwapParams,
): Promise<{ txHash: Hex; quote: QuoteResponse }> {
  // 1. Check approval — send approval tx if needed
  const approval = await checkApproval({
    token: params.tokenIn,
    amount: params.amount,
    chainId: params.chainId,
    walletAddress: params.walletAddress,
  });

  if (approval.approval.transactionRequest) {
    const approvalTx = approval.approval.transactionRequest;
    await params.sendTransaction({
      to: approvalTx.to,
      data: approvalTx.data,
      value: BigInt(approvalTx.value || "0"),
    });
  }

  // 2. Get quote
  const quote = await getQuote({
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amount: params.amount,
    type: "EXACT_INPUT",
    chainId: params.chainId,
    swapper: params.walletAddress,
  });

  // 3. Sign permit2 data if present
  let permitSignature: Hex | undefined;
  if (quote.permitData) {
    permitSignature = await params.signTypedData({
      domain: quote.permitData.domain,
      types: quote.permitData.types,
      primaryType: "PermitWitnessTransferFrom",
      message: quote.permitData.values,
    });
  }

  // 4. Create swap
  const swap = await createSwap(quote, permitSignature);

  // 5. Send the swap transaction
  const txHash = await params.sendTransaction({
    to: swap.swap.to,
    data: swap.swap.data,
    value: BigInt(swap.swap.value || "0"),
  });

  return { txHash, quote };
}
