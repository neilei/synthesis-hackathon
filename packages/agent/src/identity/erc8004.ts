/**
 * ERC-8004 on-chain agent identity (NFT registration) and reputation feedback
 * on Base. Called at agent startup for registration and after each successful
 * swap for feedback.
 *
 * @module @veil/agent/identity/erc8004
 */
import {
  createPublicClient,
  createWalletClient,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import {
  IDENTITY_REGISTRY_ABI_HUMAN,
  REPUTATION_REGISTRY_ABI_HUMAN,
} from "@veil/common";
import { env, CONTRACTS, rpcTransport } from "../config.js";

// ---------------------------------------------------------------------------
// ABI fragments for ERC-8004 registries (sourced from @veil/common)
// ---------------------------------------------------------------------------

const identityRegistryAbi = parseAbi(IDENTITY_REGISTRY_ABI_HUMAN);
const reputationRegistryAbi = parseAbi(REPUTATION_REGISTRY_ABI_HUMAN);

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

type ChainTarget = "base-sepolia" | "base";

function getChainConfig(target: ChainTarget) {
  const chain = target === "base" ? base : baseSepolia;
  const identity =
    target === "base"
      ? CONTRACTS.IDENTITY_BASE_MAINNET
      : CONTRACTS.IDENTITY_BASE_SEPOLIA;
  const reputation =
    target === "base"
      ? CONTRACTS.REPUTATION_BASE_MAINNET
      : CONTRACTS.REPUTATION_BASE_SEPOLIA;

  return { chain, identity, reputation };
}

function getClients(target: ChainTarget) {
  const { chain } = getChainConfig(target);
  const account = privateKeyToAccount(env.AGENT_PRIVATE_KEY);

  const publicClient = createPublicClient({
    chain,
    transport: rpcTransport(target),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: rpcTransport(target),
  });

  return { publicClient, walletClient, account };
}

// ---------------------------------------------------------------------------
// Register agent identity (mint NFT)
// ---------------------------------------------------------------------------

export async function registerAgent(
  agentURI: string,
  target: ChainTarget = "base-sepolia",
): Promise<{ txHash: Hex; agentId?: bigint }> {
  const config = getChainConfig(target);
  const { publicClient, walletClient, account } = getClients(target);

  const hash = await walletClient.writeContract({
    address: config.identity,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [agentURI],
    chain: walletClient.chain,
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Try to extract agentId from logs (Registered event)
  // Event: Registered(uint256 indexed agentId, string agentURI, address indexed owner)
  let agentId: bigint | undefined;
  for (const log of receipt.logs) {
    if (log.topics[1]) {
      agentId = BigInt(log.topics[1]);
      break;
    }
  }

  return { txHash: hash, agentId };
}

// ---------------------------------------------------------------------------
// Give feedback to another agent
// ---------------------------------------------------------------------------

export async function giveFeedback(
  agentId: bigint,
  value: number,
  tag1: string,
  tag2: string = "",
  target: ChainTarget = "base-sepolia",
): Promise<Hex> {
  const config = getChainConfig(target);
  const { publicClient, walletClient, account } = getClients(target);

  // Convert value to int128 with 2 decimals (e.g. 4.5 → 450)
  const valueDecimals = 2;
  const scaledValue = BigInt(Math.round(value * 10 ** valueDecimals));

  const hash = await walletClient.writeContract({
    address: config.reputation,
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [
      agentId,
      scaledValue,
      valueDecimals,
      tag1,
      tag2,
      "", // endpoint
      "", // feedbackURI
      "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex, // feedbackHash
    ],
    chain: walletClient.chain,
    account,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ---------------------------------------------------------------------------
// Read reputation summary
// ---------------------------------------------------------------------------

export async function getReputationSummary(
  agentId: bigint,
  clientAddresses: Address[],
  tag1: string = "",
  tag2: string = "",
  target: ChainTarget = "base-sepolia",
): Promise<{ count: bigint; summaryValue: bigint; summaryValueDecimals: number }> {
  const config = getChainConfig(target);
  const { publicClient } = getClients(target);

  const [count, summaryValue, summaryValueDecimals] =
    await publicClient.readContract({
      address: config.reputation,
      abi: reputationRegistryAbi,
      functionName: "getSummary",
      args: [agentId, clientAddresses, tag1, tag2],
    });

  return {
    count,
    summaryValue,
    summaryValueDecimals,
  };
}
