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

// ---------------------------------------------------------------------------
// EIP-712 primary type derivation
// ---------------------------------------------------------------------------

/**
 * Derive the EIP-712 primary type from a types object.
 * The primary type is the non-EIP712Domain key that isn't referenced
 * as a nested type by any other key.
 */
export function derivePrimaryType(
  types: Record<string, { name: string; type: string }[]>,
): string {
  const typeKeys = Object.keys(types).filter((k) => k !== "EIP712Domain");
  const referencedTypes = new Set(
    Object.values(types)
      .flat()
      .map((f) => f.type)
      .filter((t) => typeKeys.includes(t)),
  );
  const primary = typeKeys.find((k) => !referencedTypes.has(k)) ?? typeKeys[0];
  if (!primary) {
    throw new Error("No non-EIP712Domain types found in typed data");
  }
  return primary;
}

// ---------------------------------------------------------------------------
// Permit2 signing
// ---------------------------------------------------------------------------

/**
 * Sign Permit2 typed data returned from the Uniswap Trading API quote.
 * Uses {@link derivePrimaryType} to discover the EIP-712 primaryType
 * from the generic types object rather than hardcoding it.
 */
export async function signPermit2Data(
  walletClient: WalletClient,
  permitData: {
    domain: Record<string, unknown>;
    types: Record<string, unknown[]>;
    values: Record<string, unknown>;
  },
): Promise<Hex> {
  // Uniswap Trading API returns permitData as opaque JSON (Record<string, unknown>).
  // viem's signTypedData expects narrower types (TypedDataDomain, mapped type objects).
  // The actual runtime shapes match — Uniswap's API produces valid EIP-712 typed data —
  // but the TypeScript types don't align because we intentionally keep the Uniswap response
  // types generic rather than duplicating viem's internal type hierarchy.
  const typedTypes = permitData.types as Record<
    string,
    { name: string; type: string }[]
  >;

  const signature = await walletClient.signTypedData({
    account: walletClient.account!,
    domain: permitData.domain as {
      name: string;
      chainId: number;
      verifyingContract: Address;
    },
    types: typedTypes,
    primaryType: derivePrimaryType(typedTypes),
    message: permitData.values as Record<string, unknown>,
  });

  return signature;
}
