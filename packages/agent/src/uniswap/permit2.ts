/**
 * Permit2 ERC-20 approval and EIP-712 signing utilities for Uniswap swaps.
 * Handles allowance checks, max-approval transactions, and permit data signing.
 *
 * @module @veil/agent/uniswap/permit2
 */
import {
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
  parseAbi,
} from "viem";
import { CONTRACTS } from "../config.js";

// ---------------------------------------------------------------------------
// Permit2 approval check + approval tx
// ---------------------------------------------------------------------------

const PERMIT2_ABI = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration) external",
]);

const ERC20_APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

/**
 * Ensure a token is approved for Permit2.
 * 1. Check if token has approved Permit2 contract
 * 2. If not, send approval tx (max uint256)
 *
 * Returns true if an approval tx was sent.
 */
export async function ensurePermit2Approval(
  publicClient: PublicClient,
  walletClient: WalletClient,
  token: Address,
  owner: Address,
): Promise<boolean> {
  const currentAllowance = await publicClient.readContract({
    address: token,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: [owner, CONTRACTS.PERMIT2],
  });

  // If allowance is already large, skip
  if (currentAllowance > 2n ** 128n) {
    return false;
  }

  // Approve Permit2 for max uint256
  const hash = await walletClient.writeContract({
    address: token,
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [CONTRACTS.PERMIT2, 2n ** 256n - 1n],
    chain: walletClient.chain,
    account: walletClient.account!,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return true;
}

/**
 * Sign Permit2 typed data returned from the Uniswap Trading API quote.
 */
export async function signPermit2Data(
  walletClient: WalletClient,
  permitData: {
    domain: Record<string, unknown>;
    types: Record<string, unknown[]>;
    values: Record<string, unknown>;
  },
): Promise<Hex> {
  const signature = await walletClient.signTypedData({
    account: walletClient.account!,
    domain: permitData.domain as {
      name: string;
      chainId: number;
      verifyingContract: Address;
    },
    types: permitData.types as Record<
      string,
      { name: string; type: string }[]
    >,
    primaryType: "PermitWitnessTransferFrom",
    message: permitData.values as Record<string, unknown>,
  });

  return signature;
}
