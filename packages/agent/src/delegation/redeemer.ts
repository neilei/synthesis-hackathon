/**
 * ERC-7710 permission redemption. Uses the Smart Accounts Kit's
 * erc7710WalletActions to pull tokens from the user's MetaMask smart
 * account to the agent EOA, within ERC-7715 granted permission limits.
 *
 * Two-step architecture:
 * 1. Pull tokens from user's smart account → agent EOA (via delegation)
 * 2. Swap from agent EOA on Uniswap (no delegation involved)
 *
 * @module @maw/agent/delegation/redeemer
 */
import {
  createWalletClient,
  createPublicClient,
  encodeFunctionData,
  type Chain,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc7710WalletActions } from "@metamask/smart-accounts-kit/actions";
import { rpcTransport } from "../config.js";
import { logger } from "../logging/logger.js";

// Minimal ERC-20 ABI for transfer encoding
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PullNativeParams {
  agentKey: `0x${string}`;
  chain: Chain;
  agentAddress: Address;
  amount: bigint;
  permissionsContext: Hex;
  delegationManager: Address;
}

export interface PullErc20Params {
  agentKey: `0x${string}`;
  chain: Chain;
  agentAddress: Address;
  tokenAddress: Address;
  amount: bigint;
  permissionsContext: Hex;
  delegationManager: Address;
}

export interface DeployDependencyParams {
  agentKey: `0x${string}`;
  chain: Chain;
  smartAccountAddress: Address;
  dependencies: { factory: Address; factoryData: Hex }[];
}

// ---------------------------------------------------------------------------
// deploySmartAccountIfNeeded — deploy user's smart account from dependencies
// ---------------------------------------------------------------------------

export async function deploySmartAccountIfNeeded(
  params: DeployDependencyParams,
): Promise<Hex | null> {
  const publicClient = createPublicClient({
    chain: params.chain,
    transport: rpcTransport(params.chain),
  });

  const code = await publicClient.getCode({
    address: params.smartAccountAddress,
  });
  if (code && code !== "0x") {
    return null; // Already deployed
  }

  if (params.dependencies.length === 0) {
    throw new Error(
      "Smart account not deployed and no dependencies provided for deployment",
    );
  }

  const walletClient = createWalletClient({
    account: privateKeyToAccount(params.agentKey),
    chain: params.chain,
    transport: rpcTransport(params.chain),
  });

  // Deploy using the first dependency's factory
  const dep = params.dependencies[0]!;
  const txHash = await walletClient.sendTransaction({
    to: dep.factory,
    data: dep.factoryData,
    chain: params.chain,
    account: walletClient.account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`Smart account deployment failed: ${txHash}`);
  }

  logger.info(
    `User smart account deployed at ${params.smartAccountAddress} (tx: ${txHash})`,
  );
  return txHash;
}

// ---------------------------------------------------------------------------
// pullNativeToken — pull ETH from user's smart account via ERC-7710
// ---------------------------------------------------------------------------

export async function pullNativeToken(
  params: PullNativeParams,
): Promise<Hex> {
  const walletClient = createWalletClient({
    account: privateKeyToAccount(params.agentKey),
    chain: params.chain,
    transport: rpcTransport(params.chain),
  }).extend(erc7710WalletActions());

  logger.info(
    `Pulling ${params.amount} wei from user smart account via ERC-7710...`,
  );

  const txHash = await walletClient.sendTransactionWithDelegation({
    account: walletClient.account,
    chain: params.chain,
    to: params.agentAddress,
    data: "0x" as Hex,
    value: params.amount,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
  });

  return txHash;
}

// ---------------------------------------------------------------------------
// pullErc20Token — pull ERC-20 tokens from user's smart account via ERC-7710
// ---------------------------------------------------------------------------

export async function pullErc20Token(
  params: PullErc20Params,
): Promise<Hex> {
  const transferData = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [params.agentAddress, params.amount],
  });

  const walletClient = createWalletClient({
    account: privateKeyToAccount(params.agentKey),
    chain: params.chain,
    transport: rpcTransport(params.chain),
  }).extend(erc7710WalletActions());

  logger.info(
    `Pulling ${params.amount} tokens from ${params.tokenAddress} via ERC-7710...`,
  );

  const txHash = await walletClient.sendTransactionWithDelegation({
    account: walletClient.account,
    chain: params.chain,
    to: params.tokenAddress,
    data: transferData,
    value: 0n,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
  });

  return txHash;
}
